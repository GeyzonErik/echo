import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReplayService } from './replay.service';
import { CreateReplayDto } from './dto/create-replay.dto';

@Controller('replay')
export class ReplayController {
  constructor(private readonly replayService: ReplayService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() dto: CreateReplayDto) {
    return this.replayService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.replayService.findOne(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(@Param('id') id: string) {
    return this.replayService.cancel(id);
  }
}
