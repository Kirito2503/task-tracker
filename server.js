require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const SECRET_KEY = process.env.JWT_SECRET || 'fallback_secret';

// Настройка подключения к MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root_password',
    database: process.env.DB_NAME || 'tasktracker',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true, // Позволяет выполнять весь init.sql за один запрос
    ssl: {
        rejectUnauthorized: false
    }
});

// Автоматическая инициализация структуры БД
async function initDatabase() {
    try {
        const sqlPath = path.join(__dirname, 'init.sql');
        if (fs.existsSync(sqlPath)) {
            const sql = fs.readFileSync(sqlPath, 'utf8');
            await pool.query(sql);
            console.log('Таблицы базы данных успешно инициализированы.');
        } else {
            console.warn('Файл init.sql не найден, пропуск инициализации.');
        }
    } catch (err) {
        console.error('Ошибка инициализации БД:', err.message);
    }
}

// Middleware аутентификации по JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Токен отсутствует' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Невалидный токен' });
        req.user = user;
        next();
    });
};

// Middleware авторизации по ролям
const requireRole = (role) => (req, res, next) => {
    if (req.user.role !== role) {
        return res.status(403).json({ error: 'Недостаточно прав доступа' });
    }
    next();
};

// ==========================================
// БИЗНЕС-ЛОГИКА (Функция расчёта срочности)
// ==========================================
function calculateTaskUrgency(priority, status) {
    if (status === 'DONE') return 'CLOSED';
    if (priority === 'HIGH') return 'CRITICAL';
    if (priority === 'MEDIUM') return 'WARNING';
    return 'REGULAR';
}

// ==========================================
// ЭНДПОИНТЫ АУТЕНТИФИКАЦИИ
// ==========================================

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    const { email, password, role } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const userRole = role === 'ADMIN' ? 'ADMIN' : 'USER';
        
        const [result] = await pool.execute(
            'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
            [email, hash, userRole]
        );
        res.status(201).json({ id: result.insertId, email, role: userRole });
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }
        res.status(500).json({ error: e.message });
    }
});

// Авторизация
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(400).json({ error: 'Пользователь не найден' });
        }

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Неверный пароль' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            SECRET_KEY,
            { expiresIn: '8h' }
        );

        res.json({ token, role: user.role, email: user.email });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// CRUD ДЛЯ ПРОЕКТОВ
// ==========================================

app.post('/api/projects', authenticateToken, async (req, res) => {
    const { title, description } = req.body;
    try {
        const [result] = await pool.execute(
            'INSERT INTO projects (title, description, owner_id) VALUES (?, ?, ?)',
            [title, description, req.user.id]
        );
        res.status(201).json({ id: result.insertId, title, description });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM projects';
        let params = [];

        // USER видит только свои проекты, ADMIN — все
        if (req.user.role !== 'ADMIN') {
            query += ' WHERE owner_id = ?';
            params.push(req.user.id);
        }

        const [projects] = await pool.execute(query, params);
        res.json(projects);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// CRUD ДЛЯ ЗАДАЧ (С фильтрацией и бизнес-логикой)
// ==========================================

app.get('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const { priority, status } = req.query;
        let query = 'SELECT * FROM tasks WHERE 1=1';
        let params = [];

        // Ролевое ограничение видимости
        if (req.user.role !== 'ADMIN') {
            query += ' AND assigned_to = ?';
            params.push(req.user.id);
        }

        // Фильтрация
        if (priority) {
            query += ' AND priority = ?';
            params.push(priority);
        }
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        const [tasks] = await pool.execute(query, params);

        // Применение бизнес-логики к каждому объекту
        const enrichedTasks = tasks.map(t => ({
            ...t,
            urgency: calculateTaskUrgency(t.priority, t.status)
        }));

        res.json(enrichedTasks);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/tasks', authenticateToken, async (req, res) => {
    const { title, priority, project_id, assigned_to } = req.body;
    try {
        const targetUser = assigned_to || req.user.id;
        const [result] = await pool.execute(
            'INSERT INTO tasks (title, priority, project_id, assigned_to) VALUES (?, ?, ?, ?)',
            [title, priority || 'MEDIUM', project_id, targetUser]
        );
        res.status(201).json({ id: result.insertId, title, priority, project_id, assigned_to: targetUser });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/tasks/:id/status', authenticateToken, async (req, res) => {
    const { status } = req.body;
    const taskId = req.params.id;

    try {
        const [oldTask] = await pool.execute('SELECT status FROM tasks WHERE id = ?', [taskId]);
        if (oldTask.length === 0) {
            return res.status(404).json({ error: 'Задача не найдена' });
        }

        const oldStatus = oldTask[0].status;

        // Обновление статуса
        await pool.execute('UPDATE tasks SET status = ? WHERE id = ?', [status, taskId]);

        // Фиксация события в логе (Бизнес-логика / Аудит)
        await pool.execute(
            'INSERT INTO task_logs (task_id, old_status, new_status) VALUES (?, ?, ?)',
            [taskId, oldStatus, status]
        );

        res.json({ message: 'Статус обновлен', oldStatus, newStatus: status });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/tasks/:id', authenticateToken, requireRole('ADMIN'), async (req, res) => {
    try {
        await pool.execute('DELETE FROM tasks WHERE id = ?', [req.params.id]);
        res.json({ message: 'Задача удалена администратором' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = { app, calculateTaskUrgency, pool };

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, async () => {
        console.log(`Сервер запущен на порту ${PORT}`);
        await initDatabase();
    });
}