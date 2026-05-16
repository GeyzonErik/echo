import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import postgres, { Sql } from 'postgres';

export const PG_CONNECTION = 'PG_CONNECTION';

interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
}

@Global()
@Module({
  providers: [
    {
      provide: PG_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Sql => {
        const db = config.get<DatabaseConfig>('database');

        if (!db) {
          throw new Error('Database configuration is missing');
        }

        return postgres({
          host: db.host,
          port: db.port,
          user: db.user,
          password: db.password,
          database: db.database,
          max: 20,
          idle_timeout: 30,
        });
      },
    },
  ],
  exports: [PG_CONNECTION],
})
export class DatabaseModule {}
