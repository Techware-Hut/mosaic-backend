const dns = require('dns');

// Windows + some ISP resolvers refuse SRV queries from Node (querySrv ECONNREFUSED)
// while nslookup still works. mongodb+srv:// requires SRV resolution at connect time.
if (process.platform === 'win32') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

require('dotenv').config();
require('./instrument');

const app = require('./app');
const connectDB = require('./config/Db');
const { logReleaseIdentityAtStartup } = require('./utils/releaseIdentity');
const { startOnboardingReminderScheduler } = require('./jobs/onboardingReminders');

const PORT = process.env.PORT || 3001;

const startServer = async () => {
  try {
    await connectDB();
    logReleaseIdentityAtStartup();
    startOnboardingReminderScheduler();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Server startup aborted because MongoDB is unavailable.');
    const { isSentryEnabled } = require('./instrument');
    if (isSentryEnabled()) {
      const Sentry = require('./instrument');
      Sentry.captureException(err);
      await Sentry.flush(2000);
    }
    process.exit(1);
  }
};

startServer();
