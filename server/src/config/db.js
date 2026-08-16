import mongoose from 'mongoose';
import config from './env.js';
import logger from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDatabase(uri = config.db.uri, dbName = config.db.name) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  mongoose.connection.on('error', (err) => logger.error('MongoDB error', err.message));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 10000,
    autoIndex: !config.isProduction,
  });

  logger.info(`MongoDB connected → ${dbName}`);
  return mongoose.connection;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

export default mongoose;
