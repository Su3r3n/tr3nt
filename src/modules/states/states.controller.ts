import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ForkStateDto, UpdateStateDto } from './dto';
import { StatesService } from './states.service';

@Controller('states')
export class StatesController {
  constructor(private readonly statesService: StatesService) {}

  @Get(':id')
  byId(@Param('id', ParseUUIDPipe) id: string) {
    return this.statesService.requireState(id);
  }

  @Post(':id/branch')
  fork(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ForkStateDto) {
    return this.statesService.fork(id, { title: dto.title, fromMessageId: dto.fromMessageId });
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStateDto) {
    return this.statesService.update(id, dto);
  }

  /**
   * Shows exactly what the model would be given, and why. Phase 1 has no budget yet, so
   * this returns the full visible chain; Phase 3 adds token counts and eviction to the
   * same shape. It exists this early because a bad context is indistinguishable from a
   * dim model until you can read the assembled prompt.
   */
  @Get(':id/context/preview')
  async preview(@Param('id', ParseUUIDPipe) id: string) {
    const [chain, contextMessages] = await Promise.all([
      this.statesService.ancestorChain(id),
      this.statesService.contextMessages(id),
    ]);

    return {
      stateId: id,
      chain: chain.map((link) => ({
        ...link,
        role: link.upDepth === 0 ? 'focus' : 'memory',
        visibleMessages: contextMessages.filter((m) => m.stateId === link.stateId).length,
      })),
      messages: contextMessages,
      totals: {
        states: chain.length,
        messages: contextMessages.length,
        characters: contextMessages.reduce((sum, m) => sum + m.content.length, 0),
      },
      budget: {
        note: 'token budgeting arrives in Phase 3; this preview is character-counted only',
        limitTokens: Number(process.env.TR3NT_CONTEXT_BUDGET_TOKENS ?? 12000),
      },
    };
  }
}
