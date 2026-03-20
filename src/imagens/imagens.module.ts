import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ImagensController } from './imagens.controller';
import { ImagensService } from './imagens.service';

@Module({
  imports: [AuthModule],
  controllers: [ImagensController],
  providers: [ImagensService],
  exports: [ImagensService],
})
export class ImagensModule {}
