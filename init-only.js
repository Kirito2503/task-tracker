const { pool } = require('./server');
const fs = require('fs');
const path = require('path');

async function run() {
    try {
        const sqlPath = path.join(__dirname, 'init.sql');
        if (fs.existsSync(sqlPath)) {
            const sql = fs.readFileSync(sqlPath, 'utf8');
            await pool.query(sql);
            const [tables] = await pool.query('SHOW TABLES');
            console.log(`Таблицы базы данных успешно созданы: ${tables.length}`);
        } else {
            throw new Error('Файл init.sql не найден');
        }
    } catch (err) {
        console.error('Ошибка выполния SQL:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

run();