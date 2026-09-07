const { calculateTaskUrgency } = require('../server');

describe('Юнит-тесты бизнес-логики расчетной системы срочности задач', () => {

    test('1. Выполненная задача (DONE) всегда возвращает статус CLOSED независимо от приоритета', () => {
        const result = calculateTaskUrgency('HIGH', 'DONE');
        expect(result).toBe('CLOSED');
    });

    test('2. Задача с высоким приоритетом (HIGH) в процессе возвращает CRITICAL', () => {
        const result = calculateTaskUrgency('HIGH', 'IN_PROGRESS');
        expect(result).toBe('CRITICAL');
    });

    test('3. Задача с высоким приоритетом (HIGH) в статусе TODO возвращает CRITICAL', () => {
        const result = calculateTaskUrgency('HIGH', 'TODO');
        expect(result).toBe('CRITICAL');
    });

    test('4. Задача со средним приоритетом (MEDIUM) возвращает WARNING', () => {
        const result = calculateTaskUrgency('MEDIUM', 'IN_PROGRESS');
        expect(result).toBe('WARNING');
    });

    test('5. Задача с низким приоритетом (LOW) возвращает REGULAR', () => {
        const result = calculateTaskUrgency('LOW', 'TODO');
        expect(result).toBe('REGULAR');
    });

    test('6. Проверка граничного условия: низкий приоритет в статусе DONE возвращает CLOSED', () => {
        const result = calculateTaskUrgency('LOW', 'DONE');
        expect(result).toBe('CLOSED');
    });

});