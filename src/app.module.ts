import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { ChatController } from './modules/chat/chat.controller';
import { ChatService } from './modules/chat/chat.service';
import { MessagesController } from './modules/messages/messages.controller';
import { MessagesService } from './modules/messages/messages.service';
import { ProjectsController } from './modules/projects/projects.controller';
import { ProjectsService } from './modules/projects/projects.service';
import { StatesController } from './modules/states/states.controller';
import { StatesService } from './modules/states/states.service';
import { ProvidersModule } from './providers/providers.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule, ProvidersModule],
  controllers: [ProjectsController, StatesController, MessagesController, ChatController],
  providers: [ProjectsService, StatesService, MessagesService, ChatService],
})
export class AppModule {}
