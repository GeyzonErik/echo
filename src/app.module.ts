import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from './shared/config/configuration';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from './shared/database/database.module';
import { RedisModule } from './shared/redis/redis.module';
import { ReplayModule } from './modules/replay/replay.module';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BullBoardModule as QueueBoardModule } from '@bull-board/nestjs';
import { REPLAY_QUEUE } from './modules/replay/replay.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
        },
      }),
    }),
    BullBoardModule.forRoot({
      route: '/queues',
      adapter: ExpressAdapter,
    }),
    QueueBoardModule.forFeature({
      name: REPLAY_QUEUE,
      adapter: BullMQAdapter,
    }),
    DatabaseModule,
    RedisModule,
    ReplayModule,
  ],
})
export class AppModule {}
