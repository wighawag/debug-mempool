import {createClient} from '@libsql/client';
import {RemoteLibSQL} from 'remote-sql-libsql';
import {readFileSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Create an in-memory SQLite database for testing with schema applied.
 * Each call creates a fresh database instance.
 */
export async function createTestDatabase(): Promise<RemoteLibSQL> {
	// Create in-memory libsql client
	const client = createClient({url: ':memory:'});
	const remoteSQL = new RemoteLibSQL(client);

	// Load and execute schema
	const schemaPath = join(__dirname, '../../src/schema/sql/db.sql');
	const schema = readFileSync(schemaPath, 'utf-8');

	// Execute each statement separately using prepare().bind().all()
	const statements = schema.split(';').filter((s) => s.trim());
	for (const stmt of statements) {
		if (stmt.trim()) {
			const prepared = remoteSQL.prepare(stmt);
			await prepared.bind().all();
		}
	}

	return remoteSQL;
}
