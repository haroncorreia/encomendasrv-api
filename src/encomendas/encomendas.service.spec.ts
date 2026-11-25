import { ForbiddenException, BadRequestException } from '@nestjs/common';
import knexFactory, { Knex } from 'knex';
import { EncomendasService } from './encomendas.service';
import { EncomendaStatus } from './enums/encomenda-status.enum';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { BaixaAdministrativaEncomendaDto } from './dto/baixa-administrativa-encomenda.dto';
import { CreateEncomendaDto } from './dto/create-encomenda.dto';
import { UpdateEncomendaDto } from './dto/update-encomenda.dto';
import { EncomendaRestricaoRetirada } from './enums/encomenda-restricao-retirada.enum';
import { AcessoEncomendaService } from '../common/tenant/acesso-encomenda.service';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';

/** Dependências que estes testes não exercitam. */
const SEM_USO = undefined as never;

/**
 * Regra de acesso à encomenda liberando tudo: os testes deste arquivo
 * exercitam as regras do próprio `EncomendasService`. A regra de acesso tem
 * o unit dela (`acesso-encomenda.service.spec.ts`).
 */
function acessoLiberado(): AcessoEncomendaService {
  return {
    restringirLista: jest.fn().mockResolvedValue(undefined),
    assertPodeLer: jest.fn().mockResolvedValue(undefined),
    assertPodeAlterar: jest.fn().mockResolvedValue(undefined),
  } as unknown as AcessoEncomendaService;
}

describe('EncomendasService - Regras de exclusão para Portaria', () => {
  let service: EncomendasService;
  let mockKnex: any;

  beforeEach(() => {
    mockKnex = jest.fn();
    service = new EncomendasService(
      mockKnex,
      SEM_USO,
      SEM_USO,
      SEM_USO,
      SEM_USO,
      SEM_USO,
      acessoLiberado(),
    );
  });

  describe('remove (perfil PORTARIA)', () => {
    const userPortaria = {
      sub: 'user-portaria-123',
      email: 'portaria@condominio.com',
      perfil: Perfil.PORTARIA,
      uuid_condominio: 'condo-123',
    } as any;

    beforeEach(() => {
      jest.spyOn(service as any, 'findUsuarioAtivo').mockResolvedValue({
        uuid: userPortaria.sub,
        uuid_condominio: 'condo-123',
        uuid_unidade: 'unidade-123',
        perfil: Perfil.PORTARIA,
        aproved_at: new Date(),
      });
    });

    it('deve lançar ForbiddenException se a encomenda foi cadastrada por outro operador', async () => {
      const encomendaOutroOperador = {
        uuid: 'enc-1',
        uuid_condominio: 'condo-123',
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
        uuid_condominio: 'condo-123',
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
        uuid_condominio: 'condo-123',
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
        uuid_condominio: 'condo-123',
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

  describe('baixaAdministrativa', () => {
    const userAdmin = {
      sub: 'user-admin-123',
      email: 'admin@condominio.com',
      perfil: Perfil.ADMIN,
      uuid_condominio: 'condo-123',
    } as any;

    const encomendaAguardandoRetirada = {
      uuid: 'enc-baixa-1',
      uuid_usuario: 'morador-1',
      uuid_condominio: 'condo-123',
      status: EncomendaStatus.AGUARDANDO_RETIRADA,
      justificativa_baixa_administrativa: null,
    } as any;

    const mockUpdate = () => {
      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });
      return updateMock;
    };

    beforeEach(() => {
      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue(encomendaAguardandoRetirada);
      jest.spyOn(service as any, 'findUsuarioAtivo').mockResolvedValue({
        uuid: userAdmin.sub,
        uuid_condominio: 'condo-123',
        uuid_unidade: 'unidade-123',
        perfil: Perfil.ADMIN,
        aproved_at: new Date(),
      });
    });

    it('deve gravar entregue_em com a data retroativa informada e baixa_administrativa_em com o instante do registro, quando status é retirada', async () => {
      const updateMock = mockUpdate();
      const entregueEmRetroativo = '2026-01-15T10:00:00.000Z';
      const antes = new Date();

      const dto: BaixaAdministrativaEncomendaDto = {
        status: EncomendaStatus.RETIRADA,
        justificativa: 'Recebido diretamente pela administração',
        entregue_em: entregueEmRetroativo,
      };

      await service.baixaAdministrativa('enc-baixa-1', dto, userAdmin);

      const depois = new Date();
      const payload = updateMock.mock.calls[0][0];

      expect(payload.entregue_em).toEqual(new Date(entregueEmRetroativo));
      expect(payload.baixa_administrativa_em).toBeInstanceOf(Date);
      expect(payload.baixa_administrativa_em.getTime()).toBeGreaterThanOrEqual(
        antes.getTime(),
      );
      expect(payload.baixa_administrativa_em.getTime()).toBeLessThanOrEqual(
        depois.getTime(),
      );
    });

    it('deve lançar BadRequestException quando status é retirada e entregue_em não é informado', async () => {
      mockUpdate();
      const dto = {
        status: EncomendaStatus.RETIRADA,
        justificativa: 'Recebido diretamente pela administração',
      } as BaixaAdministrativaEncomendaDto;

      await expect(
        service.baixaAdministrativa('enc-baixa-1', dto, userAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando status é retirada e entregue_em está no futuro', async () => {
      mockUpdate();
      const umAnoNoFuturo = new Date();
      umAnoNoFuturo.setFullYear(umAnoNoFuturo.getFullYear() + 1);

      const dto: BaixaAdministrativaEncomendaDto = {
        status: EncomendaStatus.RETIRADA,
        justificativa: 'Recebido diretamente pela administração',
        entregue_em: umAnoNoFuturo.toISOString(),
      };

      await expect(
        service.baixaAdministrativa('enc-baixa-1', dto, userAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando status é cancelada e entregue_em é informado', async () => {
      mockUpdate();
      const dto: BaixaAdministrativaEncomendaDto = {
        status: EncomendaStatus.CANCELADA,
        justificativa: 'Encomenda extraviada',
        entregue_em: '2026-01-15T10:00:00.000Z',
      };

      await expect(
        service.baixaAdministrativa('enc-baixa-1', dto, userAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve aceitar normalmente quando status é cancelada e entregue_em não é informado', async () => {
      const updateMock = mockUpdate();
      const dto: BaixaAdministrativaEncomendaDto = {
        status: EncomendaStatus.CANCELADA,
        justificativa: 'Encomenda extraviada',
      };

      await service.baixaAdministrativa('enc-baixa-1', dto, userAdmin);

      const payload = updateMock.mock.calls[0][0];
      expect(payload.entregue_em).toBeUndefined();
      expect(payload.baixa_administrativa_em).toBeInstanceOf(Date);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      jest.spyOn(service as any, 'findUsuarioAtivo').mockResolvedValue({
        uuid: 'user-admin-123',
        uuid_condominio: 'condo-123',
        uuid_unidade: 'unidade-123',
        perfil: Perfil.ADMIN,
        aproved_at: new Date(),
      });
    });

    it('não deve incluir baixa_administrativa_em no payload ao editar campos livres da encomenda', async () => {
      const userAdmin = {
        sub: 'user-admin-123',
        email: 'admin@condominio.com',
        perfil: Perfil.ADMIN,
        uuid_condominio: 'condo-123',
      } as any;

      jest.spyOn(service, 'findActiveByUuid').mockResolvedValue({
        uuid: 'enc-baixa-1',
        uuid_usuario: 'morador-1',
        uuid_condominio: 'condo-123',
        status: EncomendaStatus.RETIRADA,
        justificativa_baixa_administrativa:
          'Recebido diretamente pela administração',
        baixa_administrativa_em: new Date('2026-01-15T10:00:00.000Z'),
      } as any);

      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });

      await service.update(
        'enc-baixa-1',
        { descricao: 'Correção de texto' },
        userAdmin,
      );

      const payload = updateMock.mock.calls[0][0];
      expect(payload).not.toHaveProperty('baixa_administrativa_em');
    });

    it('deve salvar restricao_retirada=unidade quando PATCH envia o campo como null (card #9)', async () => {
      const userAdmin = {
        sub: 'user-admin-123',
        email: 'admin@condominio.com',
        perfil: Perfil.ADMIN,
        uuid_condominio: 'condo-123',
      } as any;

      jest.spyOn(service, 'findActiveByUuid').mockResolvedValue({
        uuid: 'enc-1',
        uuid_usuario: 'morador-1',
        uuid_condominio: 'condo-123',
        restricao_retirada: EncomendaRestricaoRetirada.PESSOAL,
      } as any);

      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });

      const dto = { restricao_retirada: null } as unknown as UpdateEncomendaDto;
      await service.update('enc-1', dto, userAdmin);

      const payload = updateMock.mock.calls[0][0];
      expect(payload.restricao_retirada).toBe(
        EncomendaRestricaoRetirada.UNIDADE,
      );
    });

    it('não deve incluir restricao_retirada no payload quando o campo não é informado no PATCH', async () => {
      const userAdmin = {
        sub: 'user-admin-123',
        email: 'admin@condominio.com',
        perfil: Perfil.ADMIN,
        uuid_condominio: 'condo-123',
      } as any;

      jest.spyOn(service, 'findActiveByUuid').mockResolvedValue({
        uuid: 'enc-1',
        uuid_usuario: 'morador-1',
        uuid_condominio: 'condo-123',
        restricao_retirada: EncomendaRestricaoRetirada.PESSOAL,
      } as any);

      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });

      await service.update(
        'enc-1',
        { descricao: 'Correção de texto' },
        userAdmin,
      );

      const payload = updateMock.mock.calls[0][0];
      expect(payload).not.toHaveProperty('restricao_retirada');
    });
  });

  describe('create', () => {
    const userMorador = {
      sub: 'morador-1',
      email: 'morador@condominio.com',
      perfil: Perfil.MORADOR,
      uuid_condominio: 'condo-123',
    } as any;

    const actorMorador = {
      uuid: 'morador-1',
      uuid_condominio: 'condo-123',
      uuid_unidade: 'unidade-1',
      perfil: Perfil.MORADOR,
    };

    const mockInsert = () => {
      const insertMock = jest.fn().mockResolvedValue(undefined);
      mockKnex.mockReturnValue({ insert: insertMock });
      return insertMock;
    };

    beforeEach(() => {
      jest
        .spyOn(service as any, 'findUsuarioAtivo')
        .mockResolvedValue(actorMorador);
      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue({ uuid: 'nova-enc' } as any);
    });

    it('deve salvar restricao_retirada=unidade quando o campo não é informado na criação (card #9)', async () => {
      const insertMock = mockInsert();
      const dto = { palavra_chave: 'Chave123' } as CreateEncomendaDto;

      await service.create(dto, userMorador);

      const payload = insertMock.mock.calls[0][0];
      expect(payload.restricao_retirada).toBe(
        EncomendaRestricaoRetirada.UNIDADE,
      );
    });

    describe('isolamento por condomínio (change isolar-encomendas-e-derivados)', () => {
      const MENSAGEM_SUPER =
        'O registro de encomendas é feito pela portaria ou pela administração do condomínio.';

      /** `findUsuarioAtivo` lendo de uma tabela de usuários por uuid. */
      const usuariosPorUuid = (usuarios: Record<string, object>) =>
        jest
          .spyOn(service as any, 'findUsuarioAtivo')
          .mockImplementation((uuid: unknown) => {
            const usuario = usuarios[uuid as string];
            if (!usuario) {
              return Promise.reject(new BadRequestException('não encontrado'));
            }
            return Promise.resolve({
              uuid,
              aproved_at: new Date(),
              ...usuario,
            });
          });

      /** Gravação completa: insert e a passagem para aguardando retirada. */
      const mockGravacao = () => {
        const insertMock = jest.fn().mockResolvedValue(undefined);
        mockKnex.mockReturnValue({
          insert: insertMock,
          where: jest
            .fn()
            .mockReturnValue({ update: jest.fn().mockResolvedValue(1) }),
        });
        jest
          .spyOn(service as any, 'registerStatusEvent')
          .mockResolvedValue(undefined);
        jest
          .spyOn(service as any, 'registerStatusNotification')
          .mockResolvedValue(undefined);
        return insertMock;
      };

      const userAdminA = {
        sub: 'admin-a',
        email: 'admin@a.com',
        nome: 'Admin A',
        perfil: Perfil.ADMIN,
      } as any;

      const usuariosDoCenario = {
        'admin-a': {
          perfil: Perfil.ADMIN,
          uuid_condominio: 'condo-a',
          uuid_unidade: null,
        },
        'portaria-a': {
          perfil: Perfil.PORTARIA,
          uuid_condominio: 'condo-a',
          uuid_unidade: null,
        },
        'portaria-b': {
          perfil: Perfil.PORTARIA,
          uuid_condominio: 'condo-b',
          uuid_unidade: null,
        },
        'morador-a': {
          perfil: Perfil.MORADOR,
          uuid_condominio: 'condo-a',
          uuid_unidade: 'unidade-a',
        },
        'morador-b': {
          perfil: Perfil.MORADOR,
          uuid_condominio: 'condo-b',
          uuid_unidade: 'unidade-b',
        },
      };

      it('Super não registra encomenda: 403 com a mensagem própria, antes de qualquer leitura ou escrita', async () => {
        const insertMock = mockGravacao();
        const findUsuarioAtivo = jest.spyOn(service as any, 'findUsuarioAtivo');
        const userSuper = {
          sub: 'super-1',
          email: 'super@plataforma.com',
          nome: 'Super',
          perfil: Perfil.SUPER,
        } as any;

        await expect(
          service.create(
            {
              uuid_usuario: 'morador-a',
              recebido_por_uuid_usuario: 'portaria-a',
            },
            userSuper,
          ),
        ).rejects.toThrow(new ForbiddenException(MENSAGEM_SUPER));
        expect(findUsuarioAtivo).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
      });

      it('Super pelo cadastro (perfil do banco) também recebe 403, mesmo com token de outro perfil', async () => {
        const insertMock = mockGravacao();
        usuariosPorUuid({
          ...usuariosDoCenario,
          'admin-a': { ...usuariosDoCenario['admin-a'], perfil: Perfil.SUPER },
        });

        await expect(
          service.create(
            {
              uuid_usuario: 'morador-a',
              recebido_por_uuid_usuario: 'portaria-a',
            },
            userAdminA,
          ),
        ).rejects.toThrow(new ForbiddenException(MENSAGEM_SUPER));
        expect(insertMock).not.toHaveBeenCalled();
      });

      it('Admin não registra encomenda para morador de outro condomínio (400, sem gravar)', async () => {
        const insertMock = mockGravacao();
        usuariosPorUuid(usuariosDoCenario);

        await expect(
          service.create(
            {
              uuid_usuario: 'morador-b',
              recebido_por_uuid_usuario: 'portaria-a',
            },
            userAdminA,
          ),
        ).rejects.toThrow(
          new BadRequestException(
            'Usuário de destino deve pertencer ao mesmo condomínio do usuário autenticado.',
          ),
        );
        expect(insertMock).not.toHaveBeenCalled();
      });

      it.each([
        [
          'recebido_por_uuid_usuario',
          { recebido_por_uuid_usuario: 'portaria-b' },
        ],
        [
          'entregue_por_uuid_usuario',
          {
            recebido_por_uuid_usuario: 'portaria-a',
            entregue_por_uuid_usuario: 'portaria-b',
          },
        ],
      ])(
        'Porteiro de outro condomínio em %s: 400 citando o campo, sem gravar',
        async (campo, porteiros) => {
          const insertMock = mockGravacao();
          usuariosPorUuid(usuariosDoCenario);

          await expect(
            service.create(
              {
                uuid_usuario: 'morador-a',
                ...porteiros,
              },
              userAdminA,
            ),
          ).rejects.toThrow(
            new BadRequestException(
              `O campo ${campo} deve referenciar um usuário do mesmo condomínio da encomenda.`,
            ),
          );
          expect(insertMock).not.toHaveBeenCalled();
        },
      );

      it('Portaria sem condomínio não registra para morador sem condomínio: o destinatário já falha fechado (nulo não combina com nulo)', async () => {
        const insertMock = mockGravacao();
        usuariosPorUuid({
          'portaria-sem': {
            perfil: Perfil.PORTARIA,
            uuid_condominio: null,
            uuid_unidade: null,
          },
          'morador-sem': {
            perfil: Perfil.MORADOR,
            uuid_condominio: null,
            uuid_unidade: null,
          },
        });

        await expect(
          service.create(
            {
              uuid_usuario: 'morador-sem',
              recebido_por_uuid_usuario: 'portaria-sem',
            },
            {
              sub: 'portaria-sem',
              email: 'portaria@sem.com',
              nome: 'Portaria Sem Condomínio',
              perfil: Perfil.PORTARIA,
            } as any,
          ),
        ).rejects.toThrow(
          new BadRequestException(
            'Usuário de destino deve pertencer ao mesmo condomínio da portaria autenticada.',
          ),
        );
        expect(insertMock).not.toHaveBeenCalled();
      });

      it('Admin com morador e porteiro do próprio condomínio grava no condomínio dele, como antes', async () => {
        const insertMock = mockGravacao();
        usuariosPorUuid(usuariosDoCenario);

        await service.create(
          {
            uuid_usuario: 'morador-a',
            recebido_por_uuid_usuario: 'portaria-a',
          },
          userAdminA,
        );

        expect(insertMock).toHaveBeenCalledWith(
          expect.objectContaining({
            uuid_condominio: 'condo-a',
            uuid_usuario: 'morador-a',
            recebido_por_uuid_usuario: 'portaria-a',
          }),
        );
      });
    });

    it('deve preservar restricao_retirada=pessoal quando informado explicitamente na criação', async () => {
      const insertMock = mockInsert();
      const dto = {
        palavra_chave: 'Chave123',
        restricao_retirada: EncomendaRestricaoRetirada.PESSOAL,
      } as CreateEncomendaDto;

      await service.create(dto, userMorador);

      const payload = insertMock.mock.calls[0][0];
      expect(payload.restricao_retirada).toBe(
        EncomendaRestricaoRetirada.PESSOAL,
      );
    });
  });

  describe('findAll e findByFilters (Dual-mode Pagination & Busca)', () => {
    const userAdmin = {
      sub: 'admin-1',
      email: 'admin@condominio.com',
      perfil: Perfil.ADMIN,
      uuid_condominio: 'condo-123',
    } as any;

    it('deve retornar Array cru quando chamado sem parâmetro de paginação (cliente legado)', async () => {
      const mockEncomendas = [{ uuid: 'enc-1', status: 'recebida' }] as any[];
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findAll(userAdmin, {});

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(mockEncomendas);
    });

    it('deve retornar envelope PaginatedResult quando chamado com paginate=true', async () => {
      const mockEncomendas = [{ uuid: 'enc-1', status: 'recebida' }] as any[];
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
        clone: jest.fn().mockReturnValue({
          clearSelect: jest.fn().mockReturnThis(),
          clearOrder: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue({ count: 42 }),
          }),
        }),
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findAll(userAdmin, {
        paginate: true,
        page: 2,
        limit: 10,
      });

      expect(Array.isArray(result)).toBe(false);
      expect(result).toEqual({
        data: mockEncomendas,
        total: 42,
        page: 2,
        limit: 10,
        totalPages: 5,
      });
    });

    it('deve retornar envelope PaginatedResult no findByFilters com busca', async () => {
      const mockEncomendas = [
        { uuid: 'enc-2', status: 'aguardando retirada' },
      ] as any[];
      const andWhereMock = jest.fn();
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
        andWhere: andWhereMock,
        clone: jest.fn().mockReturnValue({
          clearSelect: jest.fn().mockReturnThis(),
          clearOrder: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue({ count: 1 }),
          }),
        }),
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findByFilters(
        {
          paginate: true,
          busca: '12345',
          page: 1,
          limit: 15,
        },
        userAdmin,
      );

      expect(result).toEqual({
        data: mockEncomendas,
        total: 1,
        page: 1,
        limit: 15,
        totalPages: 1,
      });
      expect(andWhereMock).toHaveBeenCalled();
    });

    it('deve aplicar filtro de status no findAll quando informado', async () => {
      const mockEncomendas = [
        { uuid: 'enc-prevista', status: EncomendaStatus.PREVISTA },
      ] as any[];
      const andWhereMock = jest.fn();
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
        andWhere: andWhereMock,
        clone: jest.fn().mockReturnValue({
          clearSelect: jest.fn().mockReturnThis(),
          clearOrder: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue({ count: 1 }),
          }),
        }),
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findAll(userAdmin, {
        paginate: true,
        status: EncomendaStatus.PREVISTA,
        page: 1,
        limit: 10,
      });

      expect(result).toEqual({
        data: mockEncomendas,
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(andWhereMock).toHaveBeenCalledWith(
        'status',
        EncomendaStatus.PREVISTA,
      );
    });

    it('deve retornar Array cru no findByFilters quando cliente legado não envia parâmetros de paginação', async () => {
      const mockEncomendas = [
        { uuid: 'enc-filtro-legado', status: EncomendaStatus.PREVISTA },
      ] as any[];
      const andWhereMock = jest.fn();
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
        andWhere: andWhereMock,
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findByFilters(
        {
          status: EncomendaStatus.PREVISTA,
        },
        userAdmin,
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(mockEncomendas);
      expect(andWhereMock).toHaveBeenCalledWith(
        'status',
        EncomendaStatus.PREVISTA,
      );
    });

    it('deve retornar Array cru no findAll quando cliente legado envia apenas status sem paginação', async () => {
      const mockEncomendas = [
        { uuid: 'enc-legado-status', status: EncomendaStatus.RECEBIDA },
      ] as any[];
      const andWhereMock = jest.fn();
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
        andWhere: andWhereMock,
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findAll(userAdmin, {
        status: EncomendaStatus.RECEBIDA,
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(mockEncomendas);
      expect(andWhereMock).toHaveBeenCalledWith(
        'status',
        EncomendaStatus.RECEBIDA,
      );
    });
  });
});

/**
 * Escopo das listas de encomendas pela regra única do `AcessoEncomendaService`
 * (change `isolar-encomendas-e-derivados`, #168 e #125). O knex sem conexão só
 * monta o SQL; o chamador vem de uma tabela `usuarios` em memória.
 */
describe('EncomendasService - escopo das listas', () => {
  const montador = knexFactory({ client: 'mysql2' });
  afterAll(() => montador.destroy());

  type Linha = Record<string, unknown>;

  function usuariosEmMemoria(usuarios: Linha[]): Knex {
    return jest.fn(() => {
      let resultado = [...usuarios];
      const builder = {
        where: (criterio: Linha) => {
          resultado = resultado.filter((linha) =>
            Object.entries(criterio).every(
              ([coluna, valor]) => linha[coluna] === valor,
            ),
          );
          return builder;
        },
        whereNull: (coluna: string) => {
          resultado = resultado.filter((linha) => linha[coluna] == null);
          return builder;
        },
        select: () => builder,
        first: () => Promise.resolve(resultado[0]),
      };
      return builder;
    }) as unknown as Knex;
  }

  function servicoCom(chamadorNoBanco: Linha): EncomendasService {
    const banco = usuariosEmMemoria([{ deleted_at: null, ...chamadorNoBanco }]);
    const servico = new EncomendasService(
      montador,
      SEM_USO,
      SEM_USO,
      SEM_USO,
      SEM_USO,
      SEM_USO,
      new AcessoEncomendaService(banco, new EscopoCondominioService(banco)),
    );
    // Lookup do próprio service, usado pelo escopo antes da regra única; mantido
    // para o mesmo cenário rodar contra as duas versões do escopo.
    jest.spyOn(servico as any, 'findUsuarioAtivo').mockImplementation(() =>
      Promise.resolve({
        perfil: chamadorNoBanco.perfil,
        uuid: chamadorNoBanco.uuid,
        uuid_condominio: chamadorNoBanco.uuid_condominio,
        uuid_unidade: chamadorNoBanco.uuid_unidade,
        aproved_at: new Date(),
      }),
    );
    return servico;
  }

  const sqlDo = async (
    servico: EncomendasService,
    metodo: 'scopedListQuery' | 'scopedQuery',
    user: object,
  ) => {
    const { query } = await (servico as any)[metodo](user);
    return (query as Knex.QueryBuilder).toSQL().toNative();
  };

  it.each([Perfil.ADMIN, Perfil.PORTARIA])(
    'Funcionário sem condomínio (%s): lista vazia por regra explícita (1 = 0), nunca uuid_condominio IS NULL',
    async (perfil) => {
      const servico = servicoCom({
        uuid: 'func-sem',
        perfil,
        uuid_condominio: null,
        uuid_unidade: null,
      });
      const user = { sub: 'func-sem', email: 'f@t.com', nome: 'F', perfil };

      for (const metodo of ['scopedListQuery', 'scopedQuery'] as const) {
        expect((await sqlDo(servico, metodo, user)).sql).toBe(
          'select * from `encomendas` where `deleted_at` is null and 1 = 0',
        );
      }
    },
  );

  it('Escopo do morador inclui o condomínio dele: lista com titular ou unidade compartilhada, sempre no condomínio do morador', async () => {
    const servico = servicoCom({
      uuid: 'morador-1',
      perfil: Perfil.MORADOR,
      uuid_condominio: 'condo-a',
      uuid_unidade: 'unidade-1',
    });
    const user = {
      sub: 'morador-1',
      email: 'm@t.com',
      nome: 'M',
      perfil: Perfil.MORADOR,
    };

    expect(await sqlDo(servico, 'scopedListQuery', user)).toEqual({
      sql: 'select * from `encomendas` where `deleted_at` is null and `uuid_condominio` = ? and (`uuid_usuario` = ? or (`uuid_unidade` = ? and `restricao_retirada` = ?))',
      bindings: ['condo-a', 'morador-1', 'unidade-1', 'unidade'],
    });
    // `scopedQuery` (encomendas previstas) segue só o titular, como antes.
    expect(await sqlDo(servico, 'scopedQuery', user)).toEqual({
      sql: 'select * from `encomendas` where `deleted_at` is null and `uuid_condominio` = ? and `uuid_usuario` = ?',
      bindings: ['condo-a', 'morador-1'],
    });
  });

  it('Admin e portaria do condomínio continuam com a lista do próprio condomínio', async () => {
    const servico = servicoCom({
      uuid: 'portaria-a',
      perfil: Perfil.PORTARIA,
      uuid_condominio: 'condo-a',
      uuid_unidade: null,
    });
    const user = {
      sub: 'portaria-a',
      email: 'p@t.com',
      nome: 'P',
      perfil: Perfil.PORTARIA,
    };

    expect(await sqlDo(servico, 'scopedListQuery', user)).toEqual({
      sql: 'select * from `encomendas` where `deleted_at` is null and `uuid_condominio` = ?',
      bindings: ['condo-a'],
    });
  });
});
