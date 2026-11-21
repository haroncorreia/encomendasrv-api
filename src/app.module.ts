import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { throttlerOptions } from './common/throttler/throttler.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CondominiosModule } from './condominios/condominios.module';
import { DatabaseModule } from './database/database.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DeviceTokensModule } from './device-tokens/device-tokens.module';
import { EmailModule } from './email/email.module';
import { EncomendasModule } from './encomendas/encomendas.module';
import { ImagensModule } from './imagens/imagens.module';
import { ModuloAtivoGuard } from './modulos/modulo-ativo.guard';
import { ModulosModule } from './modulos/modulos.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { PushModule } from './push/push.module';
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
    ThrottlerModule.forRoot(throttlerOptions),
    DatabaseModule,
    DashboardModule,
    EmailModule,
    UsuariosModule,
    CondominiosModule,
    ModulosModule,
    UnidadesModule,
    TransportadorasModule,
    EncomendasModule,
    ImagensModule,
    PushModule,
    NotificacoesModule,
    DeviceTokensModule,
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
    // Terceiro de propósito: o Nest executa os APP_GUARD na ordem de registro,
    // e o 403 de perfil (RolesGuard) tem precedência sobre o de módulo
    // inativo. Sem `@RequerModulo` na rota, devolve `true` sem nenhum I/O.
    {
      provide: APP_GUARD,
      useClass: ModuloAtivoGuard,
    },
  ],
})
export class AppModule {}
