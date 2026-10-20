const { neon } = require('@neondatabase/serverless');

let sql;

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

module.exports = { getSql };
