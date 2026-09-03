import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { MessagesController } from './modules/messages/messages.controller';
import { MessagesService } from './modules/messages/messages.service';
import { ProjectsController } from './modules/projects/projects.controller';
import { ProjectsService } from './modules/projects/projects.service';
import { StatesController } from './modules/states/states.controller';
import { StatesService } from './modules/states/states.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule],
  controllers: [ProjectsController, StatesController, MessagesController],
  providers: [ProjectsService, StatesService, MessagesService],
})
export class AppModule {}
