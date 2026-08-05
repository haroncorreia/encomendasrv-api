import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { EncomendasService } from './encomendas.service';
import { EncomendaStatus } from './enums/encomenda-status.enum';
import { Perfil } from '../usuarios/enums/perfil.enum';

describe('EncomendasService - Regras de exclusão para Portaria', () => {
  let service: EncomendasService;
  let mockKnex: any;

  beforeEach(() => {
    mockKnex = jest.fn();
    service = new EncomendasService(mockKnex);
  });

  describe('remove (perfil PORTARIA)', () => {
    const userPortaria = {
      sub: 'user-portaria-123',
      email: 'portaria@condominio.com',
      perfil: Perfil.PORTARIA,
      uuid_condominio: 'condo-123',
    } as any;

    it('deve lançar ForbiddenException se a encomenda foi cadastrada por outro operador', async () => {
      const encomendaOutroOperador = {
        uuid: 'enc-1',
        recebido_por_uuid_usuario: 'outro-operador-999',
        created_by: 'outro@condominio.com',
        status: EncomendaStatus.AGUARDANDO_RETIRADA,
        justificativa_baixa_administrativa: null,
      } as any;

      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue(encomendaOutroOperador);

      await expect(service.remove('enc-1', userPortaria)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('deve lançar BadRequestException se a encomenda já foi retirada por morador', async () => {
      const encomendaRetirada = {
        uuid: 'enc-2',
        recebido_por_uuid_usuario: userPortaria.sub,
        created_by: userPortaria.email,
        status: EncomendaStatus.RETIRADA,
        entregue_em: new Date(),
        justificativa_baixa_administrativa: null,
      } as any;

      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue(encomendaRetirada);

      await expect(service.remove('enc-2', userPortaria)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve lançar BadRequestException se a encomenda sofreu baixa administrativa', async () => {
      const encomendaBaixaAdmin = {
        uuid: 'enc-3',
        recebido_por_uuid_usuario: userPortaria.sub,
        created_by: userPortaria.email,
        status: EncomendaStatus.RETIRADA,
        justificativa_baixa_administrativa: 'Devolução ao remetente',
      } as any;

      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue(encomendaBaixaAdmin);

      await expect(service.remove('enc-3', userPortaria)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve permitir a exclusão de encomenda cadastrada pelo próprio operador, pendente e sem baixa admin', async () => {
      const encomendaElegivel = {
        uuid: 'enc-4',
        recebido_por_uuid_usuario: userPortaria.sub,
        created_by: userPortaria.email,
        status: EncomendaStatus.AGUARDANDO_RETIRADA,
        entregue_em: null,
        justificativa_baixa_administrativa: null,
      } as any;

      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });

      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue(encomendaElegivel);

      await service.remove('enc-4', userPortaria);

      expect(whereMock).toHaveBeenCalledWith({ uuid: 'enc-4' });
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted_by: userPortaria.email,
        }),
      );
    });
  });
});
