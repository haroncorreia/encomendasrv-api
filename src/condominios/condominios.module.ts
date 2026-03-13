import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { CondominiosController } from './condominios.controller';
import { CondominiosService } from './condominios.service';

@Module({
  imports: [AuditoriaModule],
  controllers: [CondominiosController],
  providers: [CondominiosService],
  exports: [CondominiosService],
})
export class CondominiosModule {}
