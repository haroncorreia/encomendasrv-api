import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CondominiosModule } from './condominios/condominios.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { EncomendasModule } from './encomendas/encomendas.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { TransportadorasModule } from './transportadoras/transportadoras.module';
import { UnidadesModule } from './unidades/unidades.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    EmailModule,
    UsuariosModule,
    CondominiosModule,
    UnidadesModule,
    TransportadorasModule,
    EncomendasModule,
    NotificacoesModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
