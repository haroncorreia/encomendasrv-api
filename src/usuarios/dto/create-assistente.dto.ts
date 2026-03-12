import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  IsUUID,
} from 'class-validator';

/**
 * DTO para criação de usuários com perfil 'ass' (assistente).
 * O campo perfil não é informado — é sempre definido como 'ass' pelo servidor.
 */
export class CreateAssistenteDto {
  @IsNotEmpty({ message: 'O nome é obrigatório.' })
  @IsString({ message: 'O nome deve ser válido.' })
  @Matches(/^\S+(\s+\S+)+$/, {
    message: 'Informe o nome e o sobrenome.',
  })
  nome: string;

  @IsNotEmpty({ message: 'A data de nascimento é obrigatória.' })
  @IsDateString(
    {},
    { message: 'A data de nascimento deve ser uma data válida.' },
  )
  data_nascimento: string;

  @IsNotEmpty({ message: 'O e-mail é obrigatório.' })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;

  @IsNotEmpty({ message: 'O celular é obrigatório.' })
  @Matches(/^\d{11}$/, {
    message: 'O celular deve conter exatamente 11 dígitos numéricos.',
  })
  celular: string;

  @IsNotEmpty({ message: 'A senha é obrigatória.' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/, {
    message:
      'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e símbolo.',
  })
  senha: string;

  @IsNotEmpty({ message: 'A matrícula é obrigatória.' })
  @Matches(/^\d+-\d$/, {
    message:
      'A matrícula deve conter apenas dígitos e um hífen na penúltima posição (ex: 9213384-2).',
  })
  matricula: string;

  @IsArray({
    message: 'Os vínculos do assistente devem ser informados em lista.',
  })
  @ArrayMinSize(1, {
    message: 'Informe ao menos um usuário perito/assinante para vínculo.',
  })
  @IsUUID('4', {
    each: true,
    message: 'Cada vínculo deve conter um id de usuário válido.',
  })
  ids_usuarios_vinculados: string[];
}
