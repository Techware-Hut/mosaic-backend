const dns = require('dns');

// Windows + some ISP resolvers refuse SRV queries from Node (querySrv ECONNREFUSED)
// while nslookup still works. mongodb+srv:// requires SRV resolution at connect time.
if (process.platform === 'win32') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/Db');

const PORT = process.env.PORT || 3001;

const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Server startup aborted because MongoDB is unavailable.');
    process.exit(1);
  }
};

startServer();
