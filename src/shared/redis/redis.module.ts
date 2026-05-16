import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export interface RedisConfig {
  host: string;
  port: number;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const redis = config.get<RedisConfig>('redis');

        if (!redis) {
          throw new Error('Redis configuration is missing');
        }

        return new Redis({
          host: redis.host,
          port: redis.port,
          maxRetriesPerRequest: null, // Required to bullMQ
          lazyConnect: true,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
