import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class AppendMessageDto {
  @IsIn(['user', 'assistant', 'system'])
  role!: 'user' | 'assistant' | 'system';

  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsIn(['streaming', 'complete', 'failed'])
  status?: 'streaming' | 'complete' | 'failed';

  @IsOptional()
  @IsString()
  model?: string;
}
