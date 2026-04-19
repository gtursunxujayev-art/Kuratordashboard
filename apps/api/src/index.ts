import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { assertJWTConfiguration } from './services/auth/jwt';

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

assertJWTConfiguration();

app.listen(Number(PORT), HOST, () => {
  console.log(`Kuratordashboard API running on ${HOST}:${PORT}`);
  console.log(`tRPC endpoint: http://localhost:${PORT}/api/trpc`);
});
