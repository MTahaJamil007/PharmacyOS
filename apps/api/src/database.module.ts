import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { parseEnvironment, type Environment } from '@pharmacy/config';
import { createDatabase, type Database } from '@pharmacy/database';

export const DATABASE = Symbol('DATABASE');
export const ENVIRONMENT = Symbol('ENVIRONMENT');

export class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.end({ timeout: 5 });
  }
}

@Global()
@Module({
  providers: [
    {
      provide: ENVIRONMENT,
      useFactory: (): Environment => parseEnvironment(),
    },
    {
      provide: DATABASE,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): Database => createDatabase(environment.DATABASE_URL),
    },
    DatabaseLifecycle,
  ],
  exports: [DATABASE, ENVIRONMENT],
})
export class DatabaseModule {}
