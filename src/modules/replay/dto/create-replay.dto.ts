import {
  IsString,
  IsDateString,
  IsInt,
  IsOptional,
  Min,
  Max,
} from 'class-validator';

export class CreateReplayDto {
  @IsString()
  stream!: string;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  parallelism?: number = 4;
}
