import * as dotenv from 'dotenv';

process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_PATH = '.env.test';
dotenv.config({ path: '.env.test', override: true });
