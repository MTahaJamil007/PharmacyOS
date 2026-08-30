import { Controller, Get, Inject, SetMetadata } from '@nestjs/common';
import { checkDatabase, type Database } from '@pharmacy/database';

import { DATABASE } from '../database.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  @Get('live')
  @SetMetadata('public', true)
  live(): Record<string, string> {
    return { status: 'ok' };
  }

  @Get('ready')
  @SetMetadata('public', true)
  async ready(): Promise<Record<string, string>> {
    await checkDatabase(this.database);
    return { status: 'ready', database: 'connected' };
  }
}
