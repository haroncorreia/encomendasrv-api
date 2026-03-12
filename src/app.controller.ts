import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from './auth/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Verifica a saúde da aplicação (API, banco de dados e serviço de e-mail).
   * GET /health-check
   */
  @Public()
  @Get('health-check')
  @HttpCode(HttpStatus.OK)
  async healthCheck(@Res({ passthrough: true }) res: Response) {
    const result = await this.appService.healthCheck();
    if (result.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
