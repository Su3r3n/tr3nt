import { Inject, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateProjectDto } from './dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto);
  }

  @Get()
  list() {
    return this.projects.list();
  }

  @Get(':id')
  byId(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.byId(id);
  }

  @Get(':id/root')
  root(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.rootState(id);
  }

  @Get(':id/tree')
  tree(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.tree(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.projects.remove(id);
  }
}
