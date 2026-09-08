import { Inject, Body, Controller, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../../common/errors';
import { ChatService } from './chat.service';
import { SendChatDto } from './dto';

@Controller('states/:id/chat')
export class ChatController {
  constructor(@Inject(ChatService) private readonly chatService: ChatService) {}

  /**
   * Server-sent events, written to the raw response rather than through Nest's @Sse()
   * decorator. @Sse() wants an Observable and hides the socket, and we need the socket:
   * a client that closes the tab must abort the upstream request, or we keep paying for
   * tokens nobody will read.
   *
   * Taking @Res() also opts this route out of the global exception filter, so failures
   * are turned into an `error` event by hand below.
   */
  @Post()
  async chat(
    @Param('id', ParseUUIDPipe) stateId: string,
    @Body() dto: SendChatDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    const abort = new AbortController();
    request.on('close', () => abort.abort());

    const send = (event: unknown) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of this.chatService.send(stateId, { content: dto.content }, abort.signal)) {
        send(event);
      }
    } catch (error) {
      if (error instanceof DomainError) {
        send({ type: 'error', code: error.code, message: error.message, status: error.httpStatus });
      } else {
        send({ type: 'error', code: 'internal_error', message: (error as Error).message });
      }
    } finally {
      response.end();
    }
  }
}
