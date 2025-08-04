const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.PG_URI
});

pool.query('SELECT NOW()')
  .then(() => console.log('🟢 PostgreSQL connected'))
  .catch((err) => console.error('🔴 PostgreSQL failed to connect:', err));

module.exports = {
  query: (...args) => pool.query(...args)
};
