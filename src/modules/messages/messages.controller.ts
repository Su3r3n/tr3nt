import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AppendMessageDto } from './dto';
import { MessagesService } from './messages.service';

@Controller('states/:id/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.messagesService.list(id);
  }

  @Post()
  append(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AppendMessageDto) {
    return this.messagesService.append(id, dto);
  }
}
