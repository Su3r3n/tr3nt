import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ForkStateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  /**
   * Omit to fork from the end of the parent. Supply a message id to fork from that point,
   * leaving everything after it behind in the parent.
   */
  @IsOptional()
  @IsUUID()
  fromMessageId?: string;
}

export class UpdateStateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(['active', 'abandoned', 'merged'])
  status?: 'active' | 'abandoned' | 'merged';
}
