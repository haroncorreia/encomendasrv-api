import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ParseUUIDPtPipe } from '../common/pipes/parse-uuid-pt.pipe';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { UploadImagemMultipartDto } from './dto/upload-imagem-multipart.dto';
import { ImagensService } from './imagens.service';

@Controller('imagens')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class ImagensController {
  constructor(private readonly imagensService: ImagensService) {}

  @Get()
  findAll() {
    return this.imagensService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPtPipe) id: string) {
    return this.imagensService.findOne(id);
  }

  @Get(':id/arquivo')
  async serveArquivo(
    @Param('id', ParseUUIDPtPipe) id: string,
  ): Promise<StreamableFile> {
    const imagem = await this.imagensService.findOne(id);
    return this.imagensService.serveArquivo(imagem);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA)
  @UseInterceptors(
    FileInterceptor('arquivo', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'imagens');
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const uuid = randomUUID();
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `${uuid}${ext}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|png|webp)$/)) {
          return cb(
            new BadRequestException(
              'Tipo de arquivo não permitido. Utilize jpeg, png ou webp.',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  upload(
    @UploadedFile() arquivo: Express.Multer.File,
    @Body() dto: UploadImagemMultipartDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!arquivo) {
      throw new BadRequestException('O arquivo de imagem é obrigatório.');
    }

    return this.imagensService.salvarDeArquivo({
      arquivo,
      uuidReferencia: dto.uuid_referencia,
      tabelaReferencia: dto.tabela_referencia,
      actorEmail: user.email,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  async excluir(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.imagensService.excluir(id, user.email);
  }

  @Patch(':id/restore')
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  restaurar(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.imagensService.restaurar(id, user.email);
  }
}
