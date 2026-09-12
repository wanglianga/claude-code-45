import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  @Get()
  async health() {
    await this.dataSource.query('SELECT 1');
    return { status: 'ok', service: 'psycare-api', time: new Date().toISOString() };
  }
}
