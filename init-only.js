const { pool } = require('./server');
const fs = require('fs');
const path = require('path');

async function run() {
    try {
        const sqlPath = path.join(__dirname, 'init.sql');
        if (fs.existsSync(sqlPath)) {
            const sql = fs.readFileSync(sqlPath, 'utf8');
            await pool.query(sql);
            console.log('Таблицы базы данных успешно созданы!');
        } else {
            console.error('Файл init.sql не найден');
        }
    } catch (err) {
        console.error('Ошибка выполния SQL:', err.message);
    } finally {
        await pool.end();
        process.exit();
    }
}

run();