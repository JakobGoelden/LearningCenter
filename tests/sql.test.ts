import { describe, expect, it } from 'vitest';
import { gradeSqlDrill, sqlProblems, type SqlDrill } from '../src/dojo/sql';

const setup = `CREATE TABLE t (id int PRIMARY KEY, name text, wert numeric(8,2));
INSERT INTO t VALUES (1, 'a', 10), (2, 'b', NULL), (3, 'c', 30);`;
const drill = (over: Partial<SqlDrill>): SqlDrill => ({ id: 'x', kind: 'sql', prompt: 'p', setup, solution: 'SELECT name FROM t WHERE wert > 5', ...over }) as SqlDrill;

describe('sql drills', () => {
  it('accepts another way of writing the same query, in any row order', async () => {
    const d = drill({});
    expect((await gradeSqlDrill(d, 'select name from t where wert is not null order by id desc;')).correct).toBe(true);
  });

  it('treats 10 and 10.00 as the same value', async () => {
    expect((await gradeSqlDrill(drill({ solution: 'SELECT wert FROM t WHERE id = 1' }), 'SELECT 10')).score).toBe(5);
  });

  it('names wrong rows and columns, and passes on PostgreSQL errors', async () => {
    const d = drill({});
    const rows = await gradeSqlDrill(d, 'SELECT name FROM t');
    expect(rows).toMatchObject({ correct: false, score: 1 });
    expect(rows.feedback).toContain('3 rows instead of 2');
    expect((await gradeSqlDrill(d, 'SELECT id, name FROM t WHERE wert > 5')).feedback).toContain('2 columns instead of 1');
    expect((await gradeSqlDrill(d, 'SELEC name FROM t')).feedback).toContain('PostgreSQL says');
    expect((await gradeSqlDrill(d, '   ')).score).toBe(0);
  });

  it('tells columns of the same name apart', async () => {
    const d = drill({ solution: 'SELECT a.name, b.name FROM t a JOIN t b ON a.id < b.id' });
    expect((await gradeSqlDrill(d, 'SELECT a.name, a.name FROM t a JOIN t b ON a.id < b.id')).correct).toBe(false);
  });

  it('counts the order only when it is asked for', async () => {
    const d = drill({ solution: 'SELECT id FROM t ORDER BY id DESC', ordered: true });
    expect((await gradeSqlDrill(d, 'SELECT id FROM t ORDER BY id DESC')).correct).toBe(true);
    expect(await gradeSqlDrill(d, 'SELECT id FROM t ORDER BY id')).toMatchObject({ correct: false, score: 3 });
  });

  it('compares the database after DML and DDL, and every run starts fresh', async () => {
    const dml = drill({ solution: 'DELETE FROM t WHERE wert IS NULL', check: 'SELECT * FROM t ORDER BY id' });
    expect((await gradeSqlDrill(dml, "DELETE FROM t WHERE name = 'b'")).correct).toBe(true);
    expect((await gradeSqlDrill(dml, 'DELETE FROM t')).correct).toBe(false);
    expect((await gradeSqlDrill(dml, 'DELETE FROM t WHERE id = 2; COMMIT;')).correct).toBe(true);

    const ddl = drill({ solution: 'ALTER TABLE t ADD COLUMN ort varchar(40)', check: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 't' ORDER BY 1" });
    expect((await gradeSqlDrill(ddl, 'ALTER TABLE t ADD ort varchar(40);')).correct).toBe(true);
    expect((await gradeSqlDrill(ddl, 'ALTER TABLE t ADD ort text')).correct).toBe(false);
  });

  it('finds broken and pointless drills', async () => {
    expect(await sqlProblems(drill({}))).toEqual([]);
    expect((await sqlProblems(drill({ solution: 'SELECT nope FROM t' })))[0]).toContain('solution fails');
    expect((await sqlProblems(drill({ solution: 'SELECT 1', check: 'SELECT * FROM t' })))[0]).toContain('without doing anything');
  });
});
