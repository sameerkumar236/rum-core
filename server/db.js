import dns from 'node:dns';
import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDatabase(uri) {
  // Optional fix for networks where Node cannot resolve Atlas SRV records.
  // This only changes this Node process; the computer's DNS settings stay as they are.
  if (uri.startsWith('mongodb+srv://') && config.mongoDnsServers.length) {
    dns.setServers(config.mongoDnsServers);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB.');
}
