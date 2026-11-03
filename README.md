# Pedidos de Compra · Tecar

Sistema web interno para criar, acompanhar e conferir **pedidos de compra** de peças automotivas, com cadastro de fornecedores, consulta de estoque e conferência de notas fiscais. Os pedidos seguem o layout oficial da Tecar Fiat e podem ser impressos ou exportados em PDF.

> Projeto de uso interno, feito para ser usado por vários usuários ao mesmo tempo, com os dados compartilhados em um banco único.

---

## Visão geral

O sistema substitui o preenchimento manual de pedidos. O usuário escolhe o fornecedor, informa os itens e emite o pedido: o número sequencial e a data são gerados automaticamente, e o histórico fica visível para toda a equipe.

**Principais ideias do projeto**
- Pedido de compra no mesmo layout do documento da concessionária.
- Dados compartilhados entre os usuários (fornecedores, pedidos, estoque).
- Conferência das notas fiscais que chegam com as mercadorias.
- Consulta rápida do estoque e do histórico de peças, sem sair do sistema.

---

## Funcionalidades

### Autenticação e usuários
- Login por e-mail e senha, com mensagens de erro genéricas (sem revelar se o e-mail existe).
- Vários usuários, cada um com o seu perfil.
- Área de administração para criar usuários e definir **permissões** (o que cada um pode ou não fazer).
- O administrador pode editar ou excluir pedidos de qualquer usuário, mas o campo **"Feito por"** sempre mostra quem criou o pedido originalmente.

### Pedidos de compra
- Numeração sequencial automática e data de emissão automática.
- Cabeçalho fixo da unidade (Tecar Fiat BSB W3), com endereço e CGC.
- Campos: fornecedor, CNPJ (com validação), data de emissão, **Nº da nota (obrigatório)**, itens e observações.
- Itens com quantidade, unidade, código/desenho, descrição, valor unitário, desconto, acréscimo, IPI e total por linha, além do total geral.
- Preenchimento automático de **descrição e valor** ao digitar o código de um produto cadastrado.
- Itens digitados manualmente que ainda não existem no banco são **salvos automaticamente** ao finalizar o pedido, para aparecerem nos próximos.
- **Rascunho automático:** o pedido em andamento é salvo e pode ser retomado depois.
- Duplicar pedido, atalhos de teclado (Ctrl + /) e lixeira para pedidos excluídos.
- **Impressão direta** e exportação em **PDF** (A4) com o logo do Grupo Tecar e layout do documento original.

### Histórico de pedidos
- Lista de todos os pedidos da empresa, com paginação (10 por vez) para manter o site rápido.
- Filtros por fornecedor, número do pedido e período.
- **Pesquisa por peça:** campo ao lado dos botões Limpar e Buscar, que procura pelo **código ou descrição** da peça nos itens dos pedidos (ignora maiúsculas e acentos, aceita parte do texto) e mostra os pedidos onde ela aparece, com o **Nº da nota**, o trecho encontrado destacado, a quantidade e o valor. A busca pode ser combinada com os outros filtros.
- Ações por linha: imprimir, duplicar, editar e excluir (de acordo com as permissões).

### Fornecedores
- Cadastro reutilizável, com autocompletar no pedido (nome e CNPJ).
- Tela própria para cadastrar, editar e consultar fornecedores.

### Consultar estoque
- Importação de planilha **XLS/XLSX** com código, descrição, locação, custo contábil e custo do fornecedor.
- Busca por código e descrição.
- Filtro por locação e ordenação (por locação, código ou ordem alfabética), com as locações "INDEF" sempre por último.
- Botão **"Adicionar ao pedido"**, direto da consulta.
- Exibe a data e o responsável pela última importação e avisa quando o estoque está desatualizado.
- Dentro do Novo Pedido, a consulta abre em barra lateral para não perder o pedido em andamento.

### Conferir notas
- Lista de notas fiscais vinculadas aos pedidos e também **notas avulsas**.
- Mostra fornecedor, Nº da nota, data de emissão, valor total e o pedido relacionado.
- Filtros Pendentes, Concluídas e Todas, com busca por fornecedor ou número da nota.
- Marcação de nota como conferida (concluída).
- **Contador de pendências** na barra lateral, visível também com a barra recolhida: pílula **âmbar com o número** quando há notas a conferir e **verde com um check** quando não há nenhuma.

### Segurança
- Nenhuma tela de configuração do banco, SQL, e-mail ou senha de administrador é exibida no site, nem em caso de erro. Em falhas, aparece apenas uma tela genérica ("Não foi possível carregar o sistema") com o botão de tentar novamente.
- Apenas a chave pública (`anon`) do Supabase é usada no front-end, lida de variáveis de ambiente. Nenhuma chave secreta, senha ou usuário administrador fica no código.
- Console limpo de dados sensíveis e *source maps* desativados em produção.
- Permissões por usuário e backup automático do banco.

---

## Interface

- Tema **claro**, moderno e limpo, com cartões brancos, bordas suaves e destaque em azul.
- **Barra lateral que abre e fecha** com animação suave. Ela recolhe sozinha ao abrir uma página (exceto Configurações), lembra a escolha do usuário e, no celular, vira um menu que desliza por cima do conteúdo.
- Apenas o item da página atual fica destacado no menu.
- Cabeçalho único e reutilizável: botão da barra lateral alinhado ao título, e seta de voltar somente nas telas internas (como Novo Pedido).
- Responsivo: funciona em computador, tablet e celular.
- A impressão e o PDF do pedido mantêm fundo branco e o layout do documento original.

---

## Tecnologias

- **Front-end:** React + TypeScript
- **Banco de dados e autenticação:** [Supabase](https://supabase.com) (PostgreSQL)
- **PDF:** jsPDF
- **Importação de planilhas:** biblioteca de leitura de XLS/XLSX
- **Gerenciador de pacotes:** pnpm
- **Interface criada e evoluída com** Figma Make

> Ajuste esta lista conforme as bibliotecas realmente usadas no seu `package.json`.

---

## Como rodar o projeto

### Pré-requisitos
- Node.js (versão LTS)
- pnpm
- Um projeto no Supabase

### Passo a passo

```bash
# 1. Clonar o repositório
git clone https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
cd SEU-REPOSITORIO

# 2. Instalar as dependências
pnpm install

# 3. Configurar as variáveis de ambiente (veja abaixo)

# 4. Rodar em desenvolvimento
pnpm run dev

# 5. Gerar a versão de produção
pnpm run build
```

### Variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto com os dados do seu projeto Supabase (os nomes podem variar conforme o código):

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA-CHAVE-ANON
```

> Use **somente** a chave `anon`. Nunca envie o arquivo `.env`, a chave `service_role`, senhas ou usuários administradores para o GitHub.

### Banco de dados

1. Abra o **SQL Editor** do Supabase.
2. Execute o arquivo `setup.sql` do projeto para criar tabelas, funções e permissões. Esse arquivo é executado **manualmente** no Supabase e não deve conter e-mails, senhas ou chaves.
3. Sempre que o projeto atualizar o banco, execute novamente o `setup.sql` atualizado.
4. Crie o primeiro usuário administrador pelo painel do Supabase (**Authentication → Users**), com uma senha forte, e defina o perfil dele como administrador.

---

## Estrutura do projeto

```
src/
├── App.tsx                 # Rotas e estrutura principal
├── components/             # Componentes (formulário de pedido, tabelas, barra lateral...)
├── pages/ (ou telas)       # Histórico, Novo Pedido, Estoque, Fornecedores, Notas, Configurações
├── lib/                    # Cliente do Supabase, utilitários e geração de PDF
└── styles/                 # Estilos e tokens do tema
setup.sql                   # Estrutura do banco de dados
```

> A estrutura acima é um guia: adapte para refletir as pastas reais do repositório.

---

## Telas

| Tela | O que faz |
|---|---|
| **Login** | Acesso por e-mail e senha |
| **Histórico de Pedidos** | Lista, filtra, pesquisa por peça, imprime, duplica, edita e exclui pedidos |
| **Novo Pedido** | Formulário completo do pedido, com rascunho automático |
| **Consultar Estoque** | Busca peças, importa planilha e adiciona ao pedido |
| **Fornecedores** | Cadastro e manutenção de fornecedores |
| **Conferir Notas** | Controle das notas fiscais pendentes e concluídas |
| **Configurações** | Importação de estoque, usuários e permissões |
| **Lixeira** | Pedidos excluídos, com possibilidade de restaurar |

---

## Contribuindo

1. Faça um fork do projeto.
2. Crie uma branch: `git checkout -b minha-melhoria`
3. Faça o commit: `git commit -m "Descreve a melhoria"`
4. Envie: `git push origin minha-melhoria`
5. Abra um Pull Request.

---

## Licença

Projeto de uso interno. Defina aqui a licença desejada (por exemplo, MIT) ou mantenha o repositório privado.

---

Feito por **Kelvin Calado**
