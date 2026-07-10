// ============================================
// OFFICESUPPLIES - APLICAÇÃO PRINCIPAL
// ============================================
console.log('%cOfficeSupplies — app.js versão 2025-06-17-B', 'color:#2563eb;font-weight:bold');

// ⚠️ CONFIGURAÇÃO DO SUPABASE ⚠️
// A URL já está preenchida. Falta só colar a chave "anon public" do seu
// projeto (Supabase → Project Settings → API Keys → "anon public").
const SUPABASE_URL = 'https://pwraaisyrjardodedfqc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cmFhaXN5cmphcmRvZGVkZnFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzOTIzMDEsImV4cCI6MjA5Njk2ODMwMX0.cH7Q9KGa9jTogJuSQvgYdvw8QQ2U_g7-fltC2JGUyRk';

// Inicializar Supabase com storage seguro para Edge/Safari
function createSafeStorage() {
    try {
        // Testa se o localStorage está disponível e acessível
        localStorage.setItem('__test__', '1');
        localStorage.removeItem('__test__');
        return localStorage;
    } catch (e) {
        // Fallback para memória (Edge com Tracking Prevention, modo privado, etc.)
        console.warn('localStorage bloqueado, usando storage em memória.');
        const store = {};
        return {
            getItem: (k) => store[k] ?? null,
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; }
        };
    }
}

// Inicialização segura: se a configuração estiver faltando ou o SDK não
// carregar, mostramos um aviso na tela em vez de travar no spinner.
let supabaseClient = null;
function configOk() {
    return SUPABASE_URL && !SUPABASE_URL.includes('COLE_AQUI')
        && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes('COLE_AQUI');
}
try {
    if (!window.supabase) {
        throw new Error('SDK do Supabase não carregou (verifique a conexão).');
    }
    if (!configOk()) {
        throw new Error('Configuração do Supabase incompleta no app.js (falta a chave anon public).');
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            storage: createSafeStorage(),
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false
        }
    });
} catch (e) {
    console.error('Falha ao inicializar Supabase:', e);
    // Mostra o aviso assim que a página carregar
    window.addEventListener('DOMContentLoaded', () => {
        if (typeof showFatalError === 'function') {
            showFatalError(e.message);
        } else {
            document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;text-align:center">'
                + '<h2>⚠️ Erro de configuração</h2><p>' + e.message + '</p></div>';
        }
    });
}

// ============================================
// ESTADO GLOBAL
// ============================================
let currentUser = null;
let currentProfile = null;
let currentPage = 'home';
let currentCategory = 0;
let searchQuery = '';
let modalCallback = null;
let selectedProduct = null;
let selectedQty = 1;
let filtroPegosHoje = false;
let filtroEstoqueBaixo = false;
let estoqueTab = 'todos';  // aba ativa em Estoque: 'todos' | 'baixo' | 'compras'
let comprasDias = 30;      // dias de cobertura (Lista de compras)
let comprasMargem = 20;    // margem de segurança % (Lista de compras)
let comprasFiltroTag = 'todas';   // filtro por etiqueta: todas|reposicao|alerta|sugestao
let comprasFiltroCategoria = 'todas'; // filtro por categoria
let comprasOrdem = 'cobertura';   // ordem: cobertura|alfabetica|categoria|comprar|etiqueta
let comprasQtd = {};       // quantidades editadas (itens de sugestão/alerta sem cálculo)

// Cache de dados
let cache = {
    produtos: [],
    categorias: [],
    movimentacoes: [],
    alertas: [],
    sugestoes: [],
    fornecedores: [],
    avaliacoes: {},
    colaboradores: []
};

// Títulos das páginas
const PAGE_TITLES = {
    home: 'Início',
    produtos: 'Produtos',
    estoque: 'Estoque',
    historico: 'Histórico',
    sugestoes: 'Sugestões',
    alertas: 'Alertas',
    fornecedores: 'Fornecedores',
    relatorios: 'Relatórios',
    mais: 'Mais Opções',
    'cadastro-produto': 'Cadastrar Produto',
    'colaboradores': 'Colaboradores',
    'categorias': 'Categorias',
    'configuracoes': 'Configurações'
};

// ============================================
// INICIALIZAÇÃO  (fluxo de autenticação ÚNICO)
// ============================================
// Princípio: existe UM só ponto que decide entre "mostrar login" e "montar o
// app" — a função handleAuth. Ela é idempotente (pode ser chamada várias vezes
// sem montar o app duas vezes). Tanto o getSession inicial quanto o listener
// onAuthStateChange chamam handleAuth, então nunca há disputa.

let authReady = false;         // já recebemos a primeira resposta de auth?
let appInitializedFor = null;  // id do usuário para o qual o app já foi montado
let authInProgress = false;    // evita reentrância enquanto monta o app

document.addEventListener('DOMContentLoaded', () => {
    setupLoginForm();

    if (!supabaseClient) {
        showFatalError('Configuração do Supabase incompleta no app.js (falta a chave anon public).');
        return;
    }

    // Pergunta a sessão atual uma vez (sessão restaurada do armazenamento).
    supabaseClient.auth.getSession()
        .then(({ data }) => handleAuth(data?.session?.user || null))
        .catch(err => {
            console.error('Erro ao obter sessão:', err);
            showLogin();
        });

    // Rede de segurança: se em 15s nada respondeu, mostra o login (recuperável).
    setTimeout(() => {
        if (!authReady) {
            console.warn('Auth não respondeu a tempo; mostrando login.');
            showLogin();
        }
    }, 15000);
});

function setupLoginForm() {
    const form = document.getElementById('login-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const btn = document.getElementById('login-btn');
        const errorEl = document.getElementById('login-error');

        setLoginBtnLoading(btn, true);
        errorEl.classList.remove('show');

        try {
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            // Sucesso: o listener (SIGNED_IN) chama handleAuth e monta o app.
            // O botão volta ao normal quando o app aparece ou se der erro.
        } catch (error) {
            console.error('Erro no login:', error);
            errorEl.textContent = getErrorMessage(error);
            errorEl.classList.add('show');
            setLoginBtnLoading(btn, false);
        }
    });
}

function setLoginBtnLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading ? '<span>Entrando...</span>' : '<span>Entrar</span>';
}

function isEmailValido(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function esqueciSenha() {
    const emailAtual = (document.getElementById('email')?.value || '').trim();
    const body = `
        <p style="color: var(--gray-600); margin-bottom: 16px;">
            Digite seu email e enviaremos um link para você redefinir sua senha.
        </p>
        <div class="form-group">
            <label>Email</label>
            <input type="email" id="recuperar-email" class="form-input" placeholder="seu@email.com" value="${emailAtual}">
            <div id="recuperar-erro" style="color: var(--danger); font-size: 13px; margin-top: 6px; display: none;"></div>
        </div>
    `;
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="enviarRecuperacao()">Recuperar senha</button>
    `;
    openModal('Recuperar senha', body, footer);
}

async function enviarRecuperacao() {
    const email = (document.getElementById('recuperar-email')?.value || '').trim();
    const erroEl = document.getElementById('recuperar-erro');
    const mostrarErro = (txt) => {
        if (erroEl) { erroEl.textContent = txt; erroEl.style.display = 'block'; }
    };
    if (erroEl) erroEl.style.display = 'none';

    if (!email) { mostrarErro('Digite seu email.'); return; }
    if (!isEmailValido(email)) { mostrarErro('Digite um email válido (ex: nome@empresa.com).'); return; }

    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin
        });
        if (error) throw error;
        closeModal();
        showToast('Se o email existir, enviamos um link para redefinir a senha. Verifique sua caixa de entrada.', 'success');
    } catch (error) {
        console.error('Erro ao enviar recuperação:', error);
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('rate limit')) {
            mostrarErro('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
        } else {
            mostrarErro('Erro ao enviar: ' + (error.message || 'tente novamente'));
        }
    }
}

function showFatalError(msg) {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.remove('hidden');
    const spinner = loading?.querySelector('.spinner');
    const text = loading?.querySelector('.loading-text');
    if (spinner) spinner.style.display = 'none';
    if (text) text.style.display = 'none';
    const box = document.getElementById('loading-error');
    const m = document.getElementById('loading-error-msg');
    if (m) m.textContent = msg || 'Não foi possível carregar o sistema.';
    if (box) box.style.display = 'block';
}

// ÚNICO ponto de decisão de autenticação
async function handleAuth(user) {
    authReady = true;

    // Sem usuário → tela de login
    if (!user) {
        appInitializedFor = null;
        currentUser = null;
        currentProfile = null;
        setLoginBtnLoading(document.getElementById('login-btn'), false);
        showLogin();
        return;
    }

    // App já montado para este usuário → não remonta (evita corrida em
    // eventos como TOKEN_REFRESHED, que disparam com a sessão já ativa).
    if (appInitializedFor === user.id || authInProgress) return;

    authInProgress = true;
    appInitializedFor = user.id;
    currentUser = user;

    try {
        await loadUserProfile();
        await initApp();
    } catch (e) {
        console.error('Erro ao montar o app:', e);
        appInitializedFor = null;
        showFatalError('Erro ao carregar o sistema: ' + (e.message || 'tente novamente.'));
    } finally {
        authInProgress = false;
    }
}

// Listener: qualquer mudança de auth passa pelo mesmo handleAuth
if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
        handleAuth(session?.user || null);
    });
}

// ============================================
// AUTENTICAÇÃO
// ============================================
function showLogin() {
    hideLoading();
    document.getElementById('login-page').classList.add('show');
    document.getElementById('app').classList.remove('show');
}

function showApp() {
    document.getElementById('login-page').classList.remove('show');
    document.getElementById('app').classList.add('show');
    hideLoading();
}

function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

function getErrorMessage(error) {
    const messages = {
        'Invalid login credentials': 'Email ou senha incorretos',
        'Email not confirmed': 'Confirme seu email antes de entrar',
        'Too many requests': 'Muitas tentativas. Aguarde um momento.',
        'Network error': 'Erro de conexão. Verifique sua internet.'
    };
    return messages[error.message] || 'Erro ao fazer login. Tente novamente.';
}

async function logout() {
    showLoading();
    await supabaseClient.auth.signOut();
    closeModal();
}

// ============================================
// CARREGAR DADOS
// ============================================
async function loadUserProfile() {
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .maybeSingle();
        
        if (error) throw error;
        
        if (data) {
            currentProfile = data;
        } else {
            // Rede de segurança: se por algum motivo o perfil não existir,
            // cria um perfil básico para não travar o sistema (tela branca).
            console.warn('Perfil não encontrado, criando perfil básico...');
            const novoPerfil = {
                id: currentUser.id,
                nome: currentUser.email.split('@')[0],
                email: currentUser.email,
                role: 'colaborador'
            };
            const { data: criado } = await supabaseClient
                .from('profiles')
                .insert(novoPerfil)
                .select()
                .maybeSingle();
            currentProfile = criado || novoPerfil;
        }
    } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        // Mesmo com erro, define um perfil mínimo para o app não travar
        currentProfile = currentProfile || {
            id: currentUser.id,
            nome: currentUser.email.split('@')[0],
            email: currentUser.email,
            role: 'colaborador'
        };
    }
}

async function initApp() {
    showLoading();
    
    try {
        // Atualizar UI do usuário
        updateUserUI();
        
        // Carregar dados iniciais (cada um já trata o próprio erro internamente)
        await Promise.all([
            loadCategorias(),
            loadProdutos(),
            loadAlertas(),
            loadSugestoes(),
            loadConfig(),
            loadAvaliacoes()
        ]);
        
        // Atualizar badges
        updateBadges();
        
        // Mostrar app
        showApp();
        
        // Restaurar a última página visitada (volta pra mesma tela após o F5).
        const isAdmin = currentProfile?.role === 'admin';
        // Padrão: admin começa no Início (dashboard); colaborador começa em Produtos.
        let paginaInicial = isAdmin ? 'home' : 'produtos';
        try {
            const salva = sessionStorage.getItem('ultimaPagina');
            if (salva && PAGE_TITLES[salva]) paginaInicial = salva;
        } catch (e) {}
        // Páginas exclusivas de admin (incluindo o Início) caem para 'produtos' se colaborador
        const apenasAdmin = ['home', 'cadastro-produto', 'colaboradores', 'categorias', 'configuracoes'];
        if (apenasAdmin.includes(paginaInicial) && !isAdmin) {
            paginaInicial = 'produtos';
        }
        // Captura a aba salva ANTES de navigate (que grava 'todos' e apagaria)
        let abaSalva = 'todos';
        try { abaSalva = sessionStorage.getItem('estoqueTab') || 'todos'; } catch (e) {}

        navigate(paginaInicial);

        // Se voltou para o Estoque, restaura a aba que estava ativa
        if (paginaInicial === 'estoque' && abaSalva !== 'todos') {
            estoqueTab = abaSalva;
            try { sessionStorage.setItem('estoqueTab', abaSalva); } catch (e) {}
            renderPage();
        }
        
        // Setup Push Notifications (não pode travar o app se falhar)
        try { setupPushNotifications(); } catch (e) { console.warn('Push indisponível:', e); }
    } catch (error) {
        console.error('Erro ao iniciar o app:', error);
        showFatalError('Erro ao carregar os dados: ' + (error.message || 'tente novamente.'));
    }
}

function updateUserUI() {
    const nome = currentProfile?.nome || currentUser.email.split('@')[0];
    const inicial = nome.charAt(0).toUpperCase();
    const isAdmin = currentProfile?.role === 'admin';
    
    document.getElementById('user-name').textContent = nome;
    document.getElementById('user-role').textContent = isAdmin ? 'Administrador' : 'Colaborador';
    document.getElementById('user-avatar').textContent = inicial;
    
    // Mostrar/ocultar seção admin
    const adminSection = document.getElementById('sidebar-admin-section');
    if (adminSection) {
        adminSection.style.display = isAdmin ? 'block' : 'none';
    }
    
    // Início (dashboard) é exclusivo do admin; colaborador nem vê no menu
    const homeSidebar = document.getElementById('sidebar-home');
    const homeNav = document.getElementById('nav-home');
    if (homeSidebar) homeSidebar.style.display = isAdmin ? '' : 'none';
    if (homeNav) homeNav.style.display = isAdmin ? '' : 'none';
    
    // Estoque é visão de gestão; colaborador não precisa
    const estoqueSidebar = document.getElementById('sidebar-estoque');
    if (estoqueSidebar) estoqueSidebar.style.display = isAdmin ? '' : 'none';
}

async function loadCategorias() {
    try {
        const { data, error } = await supabaseClient
            .from('categorias')
            .select('*')
            .eq('ativo', true)
            .order('nome');
        
        if (error) throw error;
        cache.categorias = data || [];
    } catch (error) {
        console.error('Erro ao carregar categorias:', error);
    }
}

async function loadProdutos() {
    try {
        const { data, error } = await supabaseClient
            .from('produtos')
            .select(`
                *,
                categorias (nome, icone),
                qrcodes (codigo)
            `)
            .eq('ativo', true)
            .order('nome');
        
        if (error) throw error;
        cache.produtos = data || [];
    } catch (error) {
        console.error('Erro ao carregar produtos:', error);
    }
}

async function loadAlertas() {
    try {
        const { data, error } = await supabaseClient
            .from('alertas')
            .select(`
                *,
                produtos (nome, icone),
                profiles!alertas_user_id_fkey (nome)
            `)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        cache.alertas = data || [];
    } catch (error) {
        console.error('Erro ao carregar alertas:', error);
    }
}

async function loadSugestoes() {
    try {
        const { data, error } = await supabaseClient
            .from('sugestoes')
            .select(`
                *,
                categorias (nome, icone),
                profiles!sugestoes_user_id_fkey (nome)
            `)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        cache.sugestoes = data || [];

        // Votos das sugestões
        const { data: votos } = await supabaseClient.from('votos_sugestao').select('*');
        cache.votosSugestao = votos || [];

        // Total de usuários ativos (base do % do time)
        const { count } = await supabaseClient
            .from('profiles').select('id', { count: 'exact', head: true }).eq('ativo', true);
        cache.totalAtivos = count || 0;
    } catch (error) {
        console.error('Erro ao carregar sugestões:', error);
    }
}

function votosDaSugestao(sugId) {
    const votos = (cache.votosSugestao || []).filter(v => v.sugestao_id === sugId);
    const apoios = votos.filter(v => v.tipo === 'apoiar').length;
    const rejeicoes = votos.filter(v => v.tipo === 'rejeitar').length;
    const meu = votos.find(v => v.user_id === currentUser?.id);
    return { apoios, rejeicoes, total: apoios + rejeicoes, meuVoto: meu ? meu.tipo : null };
}

async function votarSugestao(sugId, tipo) {
    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }
    try {
        const atual = (cache.votosSugestao || []).find(v => v.sugestao_id === sugId && v.user_id === userId);
        if (atual && atual.tipo === tipo) {
            // Clicou de novo no mesmo voto → remove
            const { error } = await supabaseClient.from('votos_sugestao')
                .delete().eq('sugestao_id', sugId).eq('user_id', userId);
            if (error) throw error;
        } else {
            const { error } = await supabaseClient.from('votos_sugestao')
                .upsert({ sugestao_id: sugId, user_id: userId, tipo }, { onConflict: 'sugestao_id,user_id' });
            if (error) throw error;
        }
        await loadSugestoes();
        renderPage();
    } catch (error) {
        console.error('Erro ao votar:', error);
        showToast('Erro ao votar: ' + (error.message || 'verifique o console'), 'error');
    }
}

async function loadMovimentacoes() {
    try {
        const isAdmin = currentProfile?.role === 'admin';
        let query = supabaseClient
            .from('movimentacoes')
            .select(`
                *,
                produtos (nome, icone, categoria_id, categorias (nome)),
                profiles (nome)
            `)
            .order('created_at', { ascending: false })
            .limit(300);

        // Colaborador só enxerga as próprias movimentações
        if (!isAdmin && currentUser?.id) {
            query = query.eq('user_id', currentUser.id);
        }

        const { data, error } = await query;
        if (error) throw error;
        cache.movimentacoes = data || [];
    } catch (error) {
        console.error('Erro ao carregar movimentações:', error);
    }
}

async function loadFornecedores() {
    try {
        const { data, error } = await supabaseClient
            .from('fornecedores')
            .select('*')
            .eq('ativo', true)
            .order('nome');
        
        if (error) throw error;
        cache.fornecedores = data || [];
    } catch (error) {
        console.error('Erro ao carregar fornecedores:', error);
    }
}

async function loadAvaliacoes() {
    if (!currentUser?.id) { cache.avaliacoes = {}; return; }
    try {
        const { data, error } = await supabaseClient
            .from('avaliacoes')
            .select('*')
            .eq('user_id', currentUser.id);
        
        if (error) throw error;
        
        cache.avaliacoes = {};
        (data || []).forEach(a => {
            cache.avaliacoes[a.produto_id] = a.tipo;
        });
    } catch (error) {
        console.error('Erro ao carregar avaliações:', error);
    }
}

// ============================================
// NAVEGAÇÃO
// ============================================
function navigate(page) {
    // Proteção de papel: colaborador não acessa telas de admin (inclusive Início)
    if (currentProfile?.role !== 'admin' && ['home', 'cadastro-produto', 'colaboradores', 'categorias', 'configuracoes'].includes(page)) {
        page = 'produtos';
    }
    currentPage = page;
    currentCategory = 0;
    searchQuery = '';
    filtroPegosHoje = false;
    filtroEstoqueBaixo = false;
    estoqueTab = 'todos';
    try { sessionStorage.setItem('estoqueTab', 'todos'); } catch (e) {}
    
    // Lembrar a página atual para restaurar ao atualizar a tela (F5)
    try { sessionStorage.setItem('ultimaPagina', page); } catch (e) {}
    
    // Atualizar título
    document.getElementById('header-title').textContent = PAGE_TITLES[page] || page;
    
    // Atualizar sidebar
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    
    // Atualizar bottom nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    
    // Renderizar página
    renderPage();
    
    // Scroll to top
    document.getElementById('main-content').scrollTop = 0;
}

function navigatePegosHoje() {
    filtroPegosHoje = true;
    filtroEstoqueBaixo = false;
    currentPage = 'historico';
    currentCategory = 0;
    searchQuery = '';
    document.getElementById('header-title').textContent = PAGE_TITLES['historico'];
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === 'historico');
    });
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === 'historico');
    });
    renderPage();
    document.getElementById('main-content').scrollTop = 0;
}

function irParaCompras() {
    estoqueTab = 'compras';
    try { sessionStorage.setItem('estoqueTab', 'compras'); } catch (e) {}
    currentPage = 'estoque';
    try { sessionStorage.setItem('ultimaPagina', 'estoque'); } catch (e) {}
    document.getElementById('header-title').textContent = PAGE_TITLES['estoque'];
    document.querySelectorAll('.sidebar-item').forEach(item => item.classList.toggle('active', item.dataset.page === 'estoque'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === 'estoque'));
    renderPage();
    document.getElementById('main-content').scrollTop = 0;
}

function navigateEstoqueBaixo() {
    filtroEstoqueBaixo = true;
    filtroPegosHoje = false;
    estoqueTab = 'baixo';
    try { sessionStorage.setItem('estoqueTab', 'baixo'); } catch (e) {}
    currentPage = 'estoque';
    currentCategory = 0;
    searchQuery = '';
    try { sessionStorage.setItem('ultimaPagina', 'estoque'); } catch (e) {}
    document.getElementById('header-title').textContent = PAGE_TITLES['estoque'];
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === 'estoque');
    });
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === 'estoque');
    });
    renderPage();
    document.getElementById('main-content').scrollTop = 0;
}

async function renderPage() {
    const main = document.getElementById('main-content');
    main.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    
    try {
        switch (currentPage) {
            case 'home':
                main.innerHTML = await renderHome();
                break;
            case 'produtos':
                main.innerHTML = await renderProdutos();
                break;
            case 'estoque':
                main.innerHTML = await renderEstoque();
                break;
            case 'historico':
                await loadMovimentacoes();
                main.innerHTML = renderHistorico();
                break;
            case 'sugestoes':
                await loadSugestoes();
                main.innerHTML = renderSugestoes();
                break;
            case 'alertas':
                await loadAlertas();
                main.innerHTML = renderAlertas();
                break;
            case 'fornecedores':
                await loadFornecedores();
                main.innerHTML = renderFornecedores();
                break;
            case 'relatorios':
                main.innerHTML = renderRelatorios();
                break;
            case 'mais':
                main.innerHTML = renderMais();
                break;
            case 'cadastro-produto':
                main.innerHTML = renderCadastroProduto();
                break;
            case 'colaboradores':
                await loadColaboradores();
                main.innerHTML = renderColaboradores();
                break;
            case 'categorias':
                await loadCategorias();
                main.innerHTML = renderCategorias();
                break;
            case 'configuracoes':
                await loadConfig();
                await loadProdutos();
                await calcularConsumos();
                main.innerHTML = renderConfiguracoes();
                break;
            default:
                main.innerHTML = renderHome();
        }
    } catch (error) {
        console.error('Erro ao renderizar página:', error);
        main.innerHTML = `
            <div class="empty-state">
                <div class="icon">❌</div>
                <h3>Erro ao carregar</h3>
                <p>${error.message}</p>
                <button class="btn btn-primary mt-4" onclick="renderPage()">Tentar novamente</button>
            </div>
        `;
    }
}

function updateBadges() {
    const count = cache.alertas.filter(a => !a.resolvido).length;
    
    ['nav-badge-alertas', 'sidebar-badge-alertas'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (count > 0) {
                el.textContent = count;
                el.style.display = 'block';
            } else {
                el.style.display = 'none';
            }
        }
    });
}

// ============================================
// RENDERIZAÇÃO - HOME
// ============================================
async function renderHome() {
    await calcularConsumos();
    const estoqueBaixo = cache.produtos.filter(p => p.estoque <= p.estoque_minimo).length;
    const alertasPendentes = cache.alertas.filter(a => (a.status || (a.resolvido ? 'aceito' : 'pendente')) === 'pendente').length;
    const sugestoesPendentes = cache.sugestoes.filter(s => s.status === 'pendente').length;
    const itensComprar = montarItensCompra().length;
    
    // Buscar últimas movimentações (com proteção contra erro)
    let ultimas = [];
    try {
        const { data, error } = await supabaseClient
            .from('movimentacoes')
            .select(`*, produtos (nome, icone), profiles (nome)`)
            .order('created_at', { ascending: false })
            .limit(5);
        if (!error) ultimas = data || [];
    } catch (e) { console.warn('Erro ao buscar últimas movimentações:', e); }
    
    const nome = currentProfile?.nome?.split(' ')[0] || 'Usuário';
    
    return `
        <div class="page-header">
            <div class="page-title">Olá, ${nome}! 👋</div>
            <div class="page-subtitle">${getGreeting()}</div>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card ${estoqueBaixo > 0 ? 'pulse' : ''}" onclick="navigateEstoqueBaixo()">
                <div class="stat-icon">📉</div>
                <div class="stat-value" style="color: ${estoqueBaixo > 0 ? 'var(--danger)' : ''}">${estoqueBaixo}</div>
                <div class="stat-label">Estoque baixo</div>
            </div>
            <div class="stat-card" onclick="irParaCompras()">
                <div class="stat-icon">🛒</div>
                <div class="stat-value">${itensComprar}</div>
                <div class="stat-label">Itens para comprar</div>
            </div>
            <div class="stat-card" onclick="navigate('alertas')">
                <div class="stat-icon">⚠️</div>
                <div class="stat-value">${alertasPendentes}</div>
                <div class="stat-label">Alertas pendentes</div>
            </div>
            <div class="stat-card" onclick="navigate('sugestoes')">
                <div class="stat-icon">💡</div>
                <div class="stat-value">${sugestoesPendentes}</div>
                <div class="stat-label">Sugestões pendentes</div>
            </div>
        </div>
        
        <div class="two-column">
            <div class="card">
                <div class="card-title">⚡ Ações Rápidas</div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                    <button class="btn btn-primary" onclick="navigate('produtos')">📦 Pegar produto</button>
                    <button class="btn btn-secondary" onclick="openSugestaoModal()">💡 Nova sugestão</button>
                    <button class="btn btn-secondary" onclick="openAlertaModal()">⚠️ Novo alerta</button>
                </div>
            </div>
            
            <div class="card">
                <div class="card-title">📜 Atividade Recente</div>
                ${(ultimas && ultimas.length > 0) ? `
                    <div class="history-list">
                        ${ultimas.map(m => `
                            <div class="history-item">
                                <div class="history-icon ${m.tipo}">${m.produtos?.icone || '📦'}</div>
                                <div class="history-content">
                                    <div class="history-title">${m.produtos?.nome || 'Produto'}</div>
                                    <div class="history-meta">${m.profiles?.nome || ''} • ${formatDate(m.created_at)}</div>
                                </div>
                                <div class="history-qty ${m.tipo}">${m.tipo === 'entrada' ? '+' : '-'}${m.quantidade}</div>
                            </div>
                        `).join('')}
                    </div>
                ` : `
                    <div class="empty-state" style="padding: 30px;">
                        <div class="icon">📜</div>
                        <p>Nenhuma atividade recente</p>
                    </div>
                `}
            </div>
        </div>
    `;
}

function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia! O que você precisa?';
    if (hour < 18) return 'Boa tarde! Como posso ajudar?';
    return 'Boa noite! Precisando de algo?';
}

// ============================================
// RENDERIZAÇÃO - PRODUTOS
// ============================================
async function renderProdutos() {
    let filtered = [...cache.produtos];
    
    if (currentCategory > 0) {
        filtered = filtered.filter(p => p.categoria_id === currentCategory);
    }
    
    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(p => p.nome.toLowerCase().includes(query));
    }
    
    const categorias = [{ id: 0, nome: 'Todos', icone: '📋' }, ...cache.categorias];
    
    return `
        <div class="page-header">
            <div class="page-title">Produtos</div>
            <div class="page-subtitle">${filtered.length} itens disponíveis</div>
        </div>
        
        <div class="search-bar">
            <div class="search-input">
                <span class="search-icon">🔍</span>
                <input 
                    type="text" 
                    placeholder="Buscar produto..." 
                    value="${searchQuery}"
                    oninput="searchQuery = this.value; renderPage();"
                >
            </div>
        </div>
        
        <div class="pills">
            ${categorias.map(c => `
                <div class="pill ${currentCategory === c.id ? 'active' : ''}" onclick="currentCategory = ${c.id}; renderPage();">
                    ${c.icone} ${c.nome}
                </div>
            `).join('')}
        </div>
        
        ${filtered.length === 0 ? `
            <div class="empty-state">
                <div class="icon">🔍</div>
                <h3>Nenhum produto encontrado</h3>
                <p>Tente buscar com outros termos</p>
            </div>
        ` : `
            <div class="product-grid">
                ${filtered.map(p => renderProductCard(p)).join('')}
            </div>
        `}
    `;
}

function renderProductCard(p) {
    const isLow = p.estoque <= p.estoque_minimo;
    const pct = Math.min(100, (p.estoque / (p.estoque_minimo * 2)) * 100);
    const fillClass = pct < 30 ? 'low' : pct < 60 ? 'medium' : 'high';
    const isAdmin = currentProfile?.role === 'admin';
    const userRating = cache.avaliacoes[p.id];
    
    return `
        <div class="product-card ${isLow ? 'low-stock' : ''}" onclick="openProductModal(${p.id})">
            <button class="quick-btn" onclick="event.stopPropagation(); quickConsume(${p.id})" title="Pegar 1">+</button>
            ${isAdmin ? `<button class="edit-btn" onclick="event.stopPropagation(); openEditProdutoModal(${p.id})" title="Editar">✏️</button>` : ''}
            <div class="product-icon">${p.icone}</div>
            <div class="product-name">${p.nome}</div>
            <div class="product-stock ${isLow ? 'danger' : ''}">${p.estoque} ${p.unidade}</div>
            <div class="stock-bar">
                <div class="stock-fill ${fillClass}" style="width: ${pct}%"></div>
            </div>
            <div class="product-rating">
                <span class="rating-item like ${userRating === 'like' ? 'active' : ''}" onclick="event.stopPropagation(); rateProduct(${p.id}, 'like')">👍 ${p.likes || 0}</span>
                <span class="rating-item dislike ${userRating === 'dislike' ? 'active' : ''}" onclick="event.stopPropagation(); rateProduct(${p.id}, 'dislike')">👎 ${p.dislikes || 0}</span>
            </div>
        </div>
    `;
}

// ============================================
// RENDERIZAÇÃO - ESTOQUE
// ============================================
async function renderEstoque() {
    const isAdmin = currentProfile?.role === 'admin';
    await calcularConsumos();
    // Segurança: a aba Compras é exclusiva de admin. Se um colaborador
    // chegar nela de algum jeito, cai em "Todos".
    if (estoqueTab === 'compras' && !isAdmin) estoqueTab = 'todos';

    const subtitulo = estoqueTab === 'baixo' ? 'Produtos abaixo do mínimo'
        : estoqueTab === 'compras' ? 'Sugestão de compra'
        : 'Ordenado por urgência';

    const conteudo = estoqueTab === 'compras'
        ? renderComprasConteudo()
        : renderEstoqueLista(estoqueTab === 'baixo');

    return `
        <div class="page-header">
            <div class="page-title">Estoque</div>
            <div class="page-subtitle">${subtitulo}</div>
        </div>

        <div class="tabs">
            <button class="tab ${estoqueTab === 'todos' ? 'active' : ''}" onclick="setEstoqueTab('todos')">Todos</button>
            <button class="tab ${estoqueTab === 'baixo' ? 'active' : ''}" onclick="setEstoqueTab('baixo')">Estoque baixo</button>
            ${isAdmin ? `<button class="tab ${estoqueTab === 'compras' ? 'active' : ''}" onclick="setEstoqueTab('compras')">Lista de compras</button>` : ''}
        </div>

        <div id="estoque-conteudo">${conteudo}</div>
    `;
}

function setComprasConfig() {
    const d = parseInt(document.getElementById('dias-cobertura')?.value);
    const m = parseInt(document.getElementById('margem-seguranca')?.value);
    if (!isNaN(d) && d > 0) comprasDias = d;
    if (!isNaN(m) && m >= 0) comprasMargem = m;
    renderPage();
}

function setEstoqueTab(tab) {
    estoqueTab = tab;
    try { sessionStorage.setItem('estoqueTab', tab); } catch (e) {}
    renderPage();
}

function renderEstoqueLista(apenasBaixo) {
    let sorted = [...cache.produtos].sort((a, b) => {
        const ca = consumoEfetivo(a), cb = consumoEfetivo(b);
        const diasA = ca > 0 ? a.estoque / ca : 999;
        const diasB = cb > 0 ? b.estoque / cb : 999;
        return diasA - diasB;
    });

    if (apenasBaixo) sorted = sorted.filter(p => p.estoque <= p.estoque_minimo);

    if (sorted.length === 0) {
        return `
            <div class="empty-state">
                <div class="icon">✅</div>
                <h3>${apenasBaixo ? 'Nenhum produto com estoque baixo' : 'Nenhum produto cadastrado'}</h3>
                <p>${apenasBaixo ? 'Todos os produtos estão dentro do limite mínimo.' : ''}</p>
            </div>`;
    }

    return sorted.map(p => {
        const consumo = consumoEfetivo(p);
        const dias = consumo > 0 ? Math.round(p.estoque / consumo) : '∞';
        const isLow = p.estoque <= p.estoque_minimo;
        const valueClass = isLow ? 'danger' : p.estoque <= p.estoque_minimo * 1.5 ? 'warning' : 'success';
        const manual = p.consumo_modo === 'manual';
        return `
            <div class="list-item" style="cursor: default;">
                <div class="list-item-icon">${p.icone}</div>
                <div class="list-item-content">
                    <div class="list-item-title">${p.nome}</div>
                    <div class="list-item-subtitle">~${consumo.toFixed(2)}/${p.unidade}/dia${manual ? ' ✏️' : ''} • Mín: ${p.estoque_minimo}</div>
                </div>
                <div class="list-item-right">
                    <div class="list-item-value ${valueClass}">${p.estoque}</div>
                    <div class="list-item-unit">~${dias} dias</div>
                </div>
            </div>`;
    }).join('');
}
// ============================================
function renderHistorico() {
    const isAdmin = currentProfile?.role === 'admin';
    let base = cache.movimentacoes;
    if (!isAdmin) base = base.filter(m => m.user_id === currentUser?.id);

    const categorias = [...new Set(cache.produtos.map(p => p.categorias?.nome).filter(Boolean))].sort();
    const usuarios = [];
    const seen = {};
    base.forEach(m => {
        if (m.user_id && !seen[m.user_id]) { seen[m.user_id] = 1; usuarios.push({ id: m.user_id, nome: m.profiles?.nome || '—' }); }
    });

    return `
        <div class="page-header">
            <div class="page-title">Histórico</div>
            <div class="page-subtitle">${isAdmin ? 'Todas as movimentações' : 'Suas movimentações'}</div>
        </div>

        <div class="card mb-4">
            <div class="config-grid">
                <div class="config-item">
                    <label>Buscar produto</label>
                    <input type="text" id="hist-busca" class="form-input" placeholder="Nome do produto" oninput="aplicarFiltrosHistorico()">
                </div>
                <div class="config-item">
                    <label>Categoria</label>
                    <select id="hist-categoria" class="form-input" onchange="aplicarFiltrosHistorico()">
                        <option value="">Todas</option>
                        ${categorias.map(c => `<option>${c}</option>`).join('')}
                    </select>
                </div>
                <div class="config-item">
                    <label>De</label>
                    <input type="date" id="hist-data-ini" class="form-input" onchange="aplicarFiltrosHistorico()">
                </div>
                <div class="config-item">
                    <label>Até</label>
                    <input type="date" id="hist-data-fim" class="form-input" onchange="aplicarFiltrosHistorico()">
                </div>
                ${isAdmin ? `
                <div class="config-item">
                    <label>Usuário</label>
                    <select id="hist-usuario" class="form-input" onchange="aplicarFiltrosHistorico()">
                        <option value="">Todos</option>
                        ${usuarios.map(u => `<option value="${u.id}">${u.nome}</option>`).join('')}
                    </select>
                </div>
                <div class="config-item">
                    <label>Tipo</label>
                    <select id="hist-tipo" class="form-input" onchange="aplicarFiltrosHistorico()">
                        <option value="">Todos</option>
                        <option value="entrada">Entradas</option>
                        <option value="saida">Saídas</option>
                    </select>
                </div>
                ` : ''}
            </div>
        </div>

        <div class="card">
            <div class="history-list" id="historico-list">
                ${renderHistoricoList(base)}
            </div>
        </div>
    `;
}

function aplicarFiltrosHistorico() {
    const isAdmin = currentProfile?.role === 'admin';
    let lista = cache.movimentacoes;
    if (!isAdmin) lista = lista.filter(m => m.user_id === currentUser?.id);

    const busca = (document.getElementById('hist-busca')?.value || '').toLowerCase();
    const cat = document.getElementById('hist-categoria')?.value || '';
    const dataIni = document.getElementById('hist-data-ini')?.value || '';
    const dataFim = document.getElementById('hist-data-fim')?.value || '';
    const usuario = document.getElementById('hist-usuario')?.value || '';
    const tipo = document.getElementById('hist-tipo')?.value || '';

    lista = lista.filter(m => {
        if (busca && !(m.produtos?.nome || '').toLowerCase().includes(busca)) return false;
        if (cat && (m.produtos?.categorias?.nome || '') !== cat) return false;
        if (usuario && m.user_id !== usuario) return false;
        if (tipo && m.tipo !== tipo) return false;
        const dia = dataLocalISO(m.created_at); // dia no fuso de Brasília
        if (dataIni && dia < dataIni) return false;
        if (dataFim && dia > dataFim) return false;
        return true;
    });

    document.getElementById('historico-list').innerHTML = renderHistoricoList(lista);
}

function renderHistoricoList(lista) {
    if (lista.length === 0) {
        return `
            <div class="empty-state">
                <div class="icon">📜</div>
                <h3>Nenhuma movimentação</h3>
            </div>
        `;
    }
    
    return lista.map(m => `
        <div class="history-item">
            <div class="history-icon ${m.tipo}">${m.produtos?.icone || '📦'}</div>
            <div class="history-content">
                <div class="history-title">${m.produtos?.nome || 'Produto'}</div>
                <div class="history-meta">${m.profiles?.nome || ''} • ${formatDate(m.created_at)}</div>
            </div>
            <div class="history-qty ${m.tipo}">${m.tipo === 'entrada' ? '+' : '-'}${m.quantidade}</div>
        </div>
    `).join('');
}

function filterHistorico(tipo, btn) {
    // Mantido por compatibilidade; a filtragem agora é por aplicarFiltrosHistorico()
    aplicarFiltrosHistorico();
}
// ============================================
// RENDERIZAÇÃO - SUGESTÕES
// ============================================
let sugOrdem = null; // null = usa o padrão do perfil
let sugView = null;  // 'lista' | 'blocos' (null = restaura da preferência)

function diasParado(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.max(0, Math.floor(diff / 86400000));
}

function getSugView() {
    if (!sugView) {
        try { sugView = sessionStorage.getItem('sugView') || 'lista'; } catch (e) { sugView = 'lista'; }
    }
    return sugView;
}

function setSugView(v) {
    sugView = v;
    try { sessionStorage.setItem('sugView', v); } catch (e) {}
    renderPage();
}

function ordenarSugestoes(lista, isAdmin) {
    const ordem = sugOrdem || (isAdmin ? 'mais_votadas' : 'nao_votados');
    const arr = [...lista];
    const v = (s) => votosDaSugestao(s.id);
    const ativos = cache.totalAtivos || 0;
    arr.sort((a, b) => {
        const va = v(a), vb = v(b);
        switch (ordem) {
            case 'mais_votadas':
                // admin: total (apoio+rejeição); colaborador: só apoios
                return (isAdmin ? vb.total - va.total : vb.apoios - va.apoios) || vb.apoios - va.apoios;
            case 'mais_apoiadas':
                return vb.apoios - va.apoios;
            case 'aprov_votantes':
                return (vb.total ? vb.apoios / vb.total : 0) - (va.total ? va.apoios / va.total : 0);
            case 'aprov_time':
                return (ativos ? vb.apoios / ativos : 0) - (ativos ? va.apoios / ativos : 0);
            case 'categoria':
                return (a.categorias?.nome || 'zzz').localeCompare(b.categorias?.nome || 'zzz') || a.nome.localeCompare(b.nome);
            case 'az':
                return a.nome.localeCompare(b.nome);
            case 'za':
                return b.nome.localeCompare(a.nome);
            case 'nao_votados':
                // não votados primeiro; depois por apoios
                return (va.meuVoto ? 1 : 0) - (vb.meuVoto ? 1 : 0) || vb.apoios - va.apoios;
            case 'antigos':
                return new Date(a.created_at) - new Date(b.created_at);
            case 'recentes':
            default:
                return new Date(b.created_at) - new Date(a.created_at);
        }
    });
    return arr;
}

function renderSugestoes() {
    const isAdmin = currentProfile?.role === 'admin';
    const view = getSugView();
    const pendentes = ordenarSugestoes(cache.sugestoes.filter(s => s.status === 'pendente'), isAdmin);
    const outras = cache.sugestoes.filter(s => s.status !== 'pendente');
    const ordemAtual = sugOrdem || (isAdmin ? 'mais_votadas' : 'nao_votados');

    const wrap = (itens) => view === 'blocos'
        ? `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px;">${itens}</div>`
        : itens;

    return `
        <div class="page-header">
            <div class="page-header-row">
                <div>
                    <div class="page-title">Sugestões</div>
                    <div class="page-subtitle">${pendentes.length} pendentes</div>
                </div>
                <div class="page-actions" style="display:flex; gap:8px;">
                    <button class="btn btn-secondary btn-sm" onclick="setSugView('${view === 'lista' ? 'blocos' : 'lista'}')" title="Alternar visualização">
                        ${view === 'lista' ? '▦ Blocos' : '☰ Lista'}
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="openSugestaoModal()">💡 Nova</button>
                </div>
            </div>
        </div>

        ${pendentes.length > 0 ? `
            <div class="card mb-4">
                <div class="config-item">
                    <label>Ordenar por</label>
                    <select class="form-input" onchange="setSugOrdem(this.value)">
                        <option value="mais_votadas" ${ordemAtual === 'mais_votadas' ? 'selected' : ''}>Mais votadas</option>
                        <option value="mais_apoiadas" ${ordemAtual === 'mais_apoiadas' ? 'selected' : ''}>Mais apoiadas</option>
                        ${isAdmin ? `
                        <option value="aprov_votantes" ${ordemAtual === 'aprov_votantes' ? 'selected' : ''}>Maior aprovação (votantes)</option>
                        <option value="aprov_time" ${ordemAtual === 'aprov_time' ? 'selected' : ''}>Maior aprovação (time)</option>
                        ` : ''}
                        <option value="nao_votados" ${ordemAtual === 'nao_votados' ? 'selected' : ''}>Não votados primeiro</option>
                        <option value="recentes" ${ordemAtual === 'recentes' ? 'selected' : ''}>Mais recentes</option>
                        <option value="antigos" ${ordemAtual === 'antigos' ? 'selected' : ''}>Mais antigos</option>
                        <option value="categoria" ${ordemAtual === 'categoria' ? 'selected' : ''}>Categoria</option>
                        <option value="az" ${ordemAtual === 'az' ? 'selected' : ''}>Nome (A–Z)</option>
                        <option value="za" ${ordemAtual === 'za' ? 'selected' : ''}>Nome (Z–A)</option>
                    </select>
                </div>
            </div>

            <div class="card">
                <div class="card-title">📬 Pendentes</div>
                ${wrap(pendentes.map(s => renderSugestaoItem(s, true)).join(''))}
            </div>
        ` : ''}

        ${outras.length > 0 ? `
            <div class="card">
                <div class="card-title">📋 Histórico</div>
                ${wrap(outras.map(s => renderSugestaoItem(s, false)).join(''))}
            </div>
        ` : ''}

        ${cache.sugestoes.length === 0 ? `
            <div class="empty-state">
                <div class="icon">💡</div>
                <h3>Nenhuma sugestão</h3>
                <p>Sugira novos produtos para o escritório!</p>
                <button class="btn btn-primary mt-4" onclick="openSugestaoModal()">Fazer Sugestão</button>
            </div>
        ` : ''}
    `;
}

function setSugOrdem(v) { sugOrdem = v; renderPage(); }

// Peças reutilizáveis do item de sugestão
function sugMeta(s, isAdmin) {
    const dias = diasParado(s.created_at);
    const cfg = cache.config || {};
    const limite = cfg.sugestaoAlertaDias != null ? cfg.sugestaoAlertaDias : 15;
    const parado = isAdmin && s.status === 'pendente' && dias >= limite;
    const cor = parado ? 'var(--danger)' : 'var(--gray-500)';
    const peso = parado ? '600' : '400';
    const dataFmt = new Date(s.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return `<div style="font-size:12px; color:var(--gray-500);">
        ${s.categorias?.nome ? `<span>${s.categorias.icone || '📦'} ${s.categorias.nome}</span> • ` : ''}${s.profiles?.nome || 'Usuário'}<br>
        ${dataFmt} • <span style="color:${cor}; font-weight:${peso};">há ${dias} ${dias === 1 ? 'dia' : 'dias'}${parado ? ' ⚠️' : ''}</span>
    </div>`;
}

function sugVotoBotoes(s, isAdmin) {
    const vt = votosDaSugestao(s.id);
    return `
        <button class="btn btn-sm" onclick="votarSugestao(${s.id}, 'apoiar')"
            style="padding:4px 8px; font-size:12px; background:${vt.meuVoto === 'apoiar' ? 'var(--success)' : 'transparent'}; color:${vt.meuVoto === 'apoiar' ? '#fff' : 'var(--success)'}; border:1px solid var(--success);">
            👍 ${vt.apoios}
        </button>
        <button class="btn btn-sm" onclick="votarSugestao(${s.id}, 'rejeitar')"
            style="padding:4px 8px; font-size:12px; background:${vt.meuVoto === 'rejeitar' ? 'var(--danger)' : 'transparent'}; color:${vt.meuVoto === 'rejeitar' ? '#fff' : 'var(--danger)'}; border:1px solid var(--danger);">
            👎${isAdmin ? ' ' + vt.rejeicoes : ''}
        </button>`;
}

function sugDecisao(s) {
    return `
        <button class="btn btn-success btn-sm" onclick="respondSugestao(${s.id}, 'aprovada')" style="padding:4px 10px; font-size:12px;">Aprovar</button>
        <button class="btn btn-danger btn-sm" onclick="respondSugestao(${s.id}, 'recusada')" style="padding:4px 10px; font-size:12px;">Recusar</button>`;
}

function sugPainelMetricas(s) {
    const vt = votosDaSugestao(s.id);
    const ativos = cache.totalAtivos || 0;
    const pctApoio = vt.total ? Math.round((vt.apoios / vt.total) * 100) : 0;
    const pctRej = vt.total ? Math.round((vt.rejeicoes / vt.total) * 100) : 0;
    const pctPartic = ativos ? Math.round((vt.total / ativos) * 100) : 0;
    const pctTime = ativos ? Math.round((vt.apoios / ativos) * 100) : 0;
    return `
        <div style="background:var(--gray-100,#f5f5f5); border-radius:10px; padding:10px 12px; font-size:13px; line-height:1.7;">
            <div style="font-size:15px;">
                <span style="color:var(--success); font-weight:700;">👍 ${vt.apoios} (${pctApoio}%)</span>
                &nbsp;·&nbsp;
                <span style="color:var(--danger); font-weight:700;">👎 ${vt.rejeicoes} (${pctRej}%)</span>
            </div>
            <div style="color:var(--gray-600);">Total: ${vt.total} votos (${pctPartic}% do time)</div>
            <div style="color:var(--gray-600);">Aprovação — votantes: <strong>${pctApoio}%</strong> · time: <strong>${pctTime}%</strong></div>
        </div>`;
}

function renderSugestaoItem(s, pendente) {
    const isAdmin = currentProfile?.role === 'admin';
    const view = getSugView();
    const statusBadge = {
        pendente: '<span class="badge badge-warning">Pendente</span>',
        aprovada: '<span class="badge badge-success">Aprovada</span>',
        recusada: '<span class="badge badge-danger">Recusada</span>',
        comprada: '<span class="badge badge-success">✓ Comprada</span>'
    };
    const vt = votosDaSugestao(s.id);

    const titulo = `<div style="font-weight:600;">${s.nome} ${!pendente ? statusBadge[s.status] : ''}</div>`;
    const justi = s.justificativa ? `<div style="font-size:12px; color:var(--gray-600); margin-top:2px;"><em>"${s.justificativa}"</em></div>` : '';
    const votos = pendente ? sugVotoBotoes(s, isAdmin) : `<span style="font-size:13px; color:var(--success);">👍 ${vt.apoios}</span>`;
    const painel = (pendente && isAdmin) ? sugPainelMetricas(s) : '';
    const decisao = (pendente && isAdmin) ? sugDecisao(s) : '';

    if (view === 'blocos') {
        return `
            <div class="card" style="margin:0; padding:14px;">
                ${titulo}
                ${sugMeta(s, isAdmin)}
                ${justi}
                ${painel ? `<div style="margin-top:8px;">${painel}</div>` : ''}
                <div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                    ${votos}
                    ${decisao ? `<div style="flex-basis:100%; height:0;"></div>${decisao}` : ''}
                </div>
            </div>`;
    }

    // Lista
    return `
        <div class="list-item" style="cursor:default; align-items:flex-start; gap:10px;">
            <div class="list-item-icon">${s.categorias?.icone || '📦'}</div>
            <div class="list-item-content">
                ${titulo}
                ${sugMeta(s, isAdmin)}
                ${justi}
                <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                    ${votos}
                    ${decisao}
                </div>
            </div>
            ${painel ? `<div style="width:190px; flex-shrink:0;">${painel}</div>` : ''}
        </div>`;
}

async function respondSugestao(id, status) {
    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }
    try {
        const { error } = await supabaseClient
            .from('sugestoes')
            .update({
                status,
                respondido_por: userId,
                respondido_em: new Date().toISOString()
            })
            .eq('id', id);
        
        if (error) throw error;
        
        showToast(status === 'aprovada' ? 'Sugestão aprovada! Adicionada à lista de compras.' : 'Sugestão recusada', 'success');
        await loadSugestoes();
        renderPage();
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao responder sugestão', 'error');
    }
}

// ============================================
// RENDERIZAÇÃO - ALERTAS
// ============================================
function renderAlertas() {
    const isAdmin = currentProfile?.role === 'admin';
    const st = (a) => a.status || (a.resolvido ? 'aceito' : 'pendente');
    const pendentes = cache.alertas.filter(a => st(a) === 'pendente');
    const processados = cache.alertas.filter(a => st(a) !== 'pendente');
    
    return `
        <div class="page-header">
            <div class="page-header-row">
                <div>
                    <div class="page-title">Alertas</div>
                    <div class="page-subtitle">${pendentes.length} pendentes</div>
                </div>
                <div class="page-actions">
                    <button class="btn btn-primary btn-sm" onclick="openAlertaModal()">⚠️ Novo Alerta</button>
                </div>
            </div>
        </div>
        
        ${pendentes.length > 0 ? `
            <div class="card">
                <div class="card-title">🔔 Pendentes</div>
                ${pendentes.map(a => renderAlertaItem(a, isAdmin)).join('')}
            </div>
        ` : ''}
        
        ${processados.length > 0 ? `
            <div class="card">
                <div class="card-title">📋 Processados</div>
                ${processados.slice(0, 15).map(a => renderAlertaItem(a, false)).join('')}
            </div>
        ` : ''}
        
        ${cache.alertas.length === 0 ? `
            <div class="empty-state">
                <div class="icon">✅</div>
                <h3>Nenhum alerta</h3>
                <p>Tudo em ordem por aqui!</p>
            </div>
        ` : ''}
    `;
}

function renderAlertaItem(a, showActions) {
    const urgenciaClass = { baixo: 'baixa', medio: 'media', alto: 'alta' };
    const status = a.status || (a.resolvido ? 'aceito' : 'pendente');

    let statusHtml = '';
    if (status === 'aceito') {
        statusHtml = `<span class="badge badge-success" style="white-space:nowrap;">✓ Adicionado à lista de compras</span>`;
    } else if (status === 'comprado') {
        statusHtml = `<span class="badge badge-success" style="white-space:nowrap;">✓ Comprado</span>`;
    } else if (status === 'recusado') {
        statusHtml = `<span class="badge badge-danger">Recusado</span>`;
    }

    const acoes = (showActions && status === 'pendente') ? `
        <div style="margin-top: 8px; display: flex; gap: 8px; justify-content:flex-end;">
            <button class="btn btn-success btn-sm" onclick="aceitarAlerta(${a.id})" style="padding: 6px 12px;" title="Adicionar à lista de compras">✓</button>
            <button class="btn btn-danger btn-sm" onclick="recusarAlerta(${a.id})" style="padding: 6px 12px;" title="Recusar">✗</button>
        </div>` : '';

    return `
        <div class="list-item" style="cursor: default; ${status === 'recusado' ? 'opacity: 0.6;' : ''}">
            <div class="list-item-icon">${a.produtos?.icone || '⚠️'}</div>
            <div class="list-item-content">
                <div class="list-item-title">${a.produtos?.nome || 'Alerta Geral'}</div>
                <div class="list-item-subtitle">
                    ${a.profiles?.nome || 'Usuário'} • ${formatDate(a.created_at)}
                    ${a.descricao ? `<br>${a.descricao}` : ''}
                </div>
            </div>
            <div class="list-item-right">
                <span class="priority ${urgenciaClass[a.urgencia]}">${a.urgencia}</span>
                ${statusHtml ? `<div style="margin-top:6px;">${statusHtml}</div>` : ''}
                ${acoes}
            </div>
        </div>
    `;
}

async function aceitarAlerta(id) {
    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }
    try {
        const { error } = await supabaseClient
            .from('alertas')
            .update({
                status: 'aceito',
                resolvido: true,
                resolvido_por: userId,
                resolvido_em: new Date().toISOString()
            })
            .eq('id', id);
        if (error) { console.error('Erro Supabase aceitarAlerta:', error); throw error; }
        showToast('Adicionado à lista de compras!', 'success');
        await loadAlertas();
        updateBadges();
        renderPage();
    } catch (error) {
        console.error('Erro ao aceitar alerta:', error);
        showToast('Erro ao aceitar: ' + (error.message || 'verifique o console'), 'error');
    }
}

async function recusarAlerta(id) {
    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }
    try {
        const { error } = await supabaseClient
            .from('alertas')
            .update({
                status: 'recusado',
                resolvido: true,
                resolvido_por: userId,
                resolvido_em: new Date().toISOString()
            })
            .eq('id', id);
        if (error) { console.error('Erro Supabase recusarAlerta:', error); throw error; }
        showToast('Alerta recusado', 'success');
        await loadAlertas();
        updateBadges();
        renderPage();
    } catch (error) {
        console.error('Erro ao recusar alerta:', error);
        showToast('Erro ao recusar: ' + (error.message || 'verifique o console'), 'error');
    }
}
// ============================================
// RENDERIZAÇÃO - ENTRADA DE ESTOQUE
// ============================================
function renderEntrada() {
    return `
        <div class="page-header">
            <div class="page-title">Entrada de Estoque</div>
            <div class="page-subtitle">Registrar recebimento de produtos</div>
        </div>
        
        <div class="search-bar">
            <div class="search-input">
                <span class="search-icon">🔍</span>
                <input 
                    type="text" 
                    placeholder="Buscar produto para dar entrada..." 
                    oninput="filterEntrada(this.value)"
                >
            </div>
        </div>
        
        <div id="entrada-list">
            ${cache.produtos.map(p => `
                <div class="list-item" onclick="openEntradaModal(${p.id})">
                    <div class="list-item-icon">${p.icone}</div>
                    <div class="list-item-content">
                        <div class="list-item-title">${p.nome}</div>
                        <div class="list-item-subtitle">Estoque atual: ${p.estoque} ${p.unidade}</div>
                    </div>
                    <div class="list-item-right">
                        <button class="btn btn-success btn-sm">+ Entrada</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function filterEntrada(query) {
    const q = query.toLowerCase();
    const filtered = cache.produtos.filter(p => p.nome.toLowerCase().includes(q));
    
    document.getElementById('entrada-list').innerHTML = filtered.map(p => `
        <div class="list-item" onclick="openEntradaModal(${p.id})">
            <div class="list-item-icon">${p.icone}</div>
            <div class="list-item-content">
                <div class="list-item-title">${p.nome}</div>
                <div class="list-item-subtitle">Estoque atual: ${p.estoque} ${p.unidade}</div>
            </div>
            <div class="list-item-right">
                <button class="btn btn-success btn-sm">+ Entrada</button>
            </div>
        </div>
    `).join('');
}

// ============================================
// RENDERIZAÇÃO - FORNECEDORES
// ============================================
function renderFornecedores() {
    return `
        <div class="page-header">
            <div class="page-header-row">
                <div>
                    <div class="page-title">Fornecedores</div>
                    <div class="page-subtitle">${cache.fornecedores.length} cadastrados</div>
                </div>
                <div class="page-actions">
                    <button class="btn btn-primary btn-sm" onclick="openFornecedorModal()">+ Novo Fornecedor</button>
                </div>
            </div>
        </div>
        
        ${cache.fornecedores.length === 0 ? `
            <div class="empty-state">
                <div class="icon">🏪</div>
                <h3>Nenhum fornecedor</h3>
                <p>Cadastre seus fornecedores para controlar preços</p>
                <button class="btn btn-primary mt-4" onclick="openFornecedorModal()">Cadastrar Fornecedor</button>
            </div>
        ` : `
            ${cache.fornecedores.map(f => `
                <div class="list-item" onclick="openFornecedorModal(${f.id})">
                    <div class="list-item-icon">🏪</div>
                    <div class="list-item-content">
                        <div class="list-item-title">${f.nome}</div>
                        <div class="list-item-subtitle">${f.contato || ''} ${f.telefone ? '• ' + f.telefone : ''}</div>
                    </div>
                </div>
            `).join('')}
        `}
    `;
}

// ============================================
// RENDERIZAÇÃO - LISTA DE COMPRAS
// ============================================
// Etiquetas (origem) dos itens de compra
const COMPRA_TAGS = {
    reposicao: { label: 'Reposição', cor: '#2563eb', bg: 'rgba(37,99,235,0.12)' },
    alerta:    { label: 'Alerta',    cor: '#d97706', bg: 'rgba(217,119,6,0.14)' },
    sugestao:  { label: 'Sugestão',  cor: '#7c3aed', bg: 'rgba(124,58,237,0.12)' }
};

// Monta a lista consolidada de itens a comprar, juntando as 3 fontes.
// ============================================
// CONSUMO MÉDIO (automático pelo histórico)
// ============================================
async function loadConfig() {
    try {
        const { data, error } = await supabaseClient.from('configuracoes').select('*').eq('id', 1).single();
        if (error) throw error;
        cache.config = {
            periodo: data.consumo_periodo_dias || 30,
            diasSemana: (data.consumo_dias_semana || '0,1,2,3,4,5,6').split(',').map(n => parseInt(n)).filter(n => !isNaN(n)),
            sugestaoAlertaDias: data.sugestao_alerta_dias != null ? data.sugestao_alerta_dias : 15
        };
    } catch (e) {
        console.warn('Erro ao carregar configurações:', e);
        cache.config = cache.config || { periodo: 30, diasSemana: [0, 1, 2, 3, 4, 5, 6] };
    }
}

function contarDiasConsiderados(periodo, diasSemana) {
    let count = 0;
    const hoje = new Date();
    for (let i = 1; i <= periodo; i++) {
        const d = new Date(hoje);
        d.setDate(hoje.getDate() - i);
        if (diasSemana.includes(d.getDay())) count++;
    }
    return count;
}

async function calcularConsumos() {
    try {
        const cfg = cache.config || { periodo: 30, diasSemana: [0, 1, 2, 3, 4, 5, 6] };
        const periodo = cfg.periodo || 30;
        const dias = (cfg.diasSemana && cfg.diasSemana.length) ? cfg.diasSemana : [0, 1, 2, 3, 4, 5, 6];
        const inicio = new Date();
        inicio.setDate(inicio.getDate() - periodo);

        const { data, error } = await supabaseClient
            .from('movimentacoes')
            .select('produto_id, quantidade, tipo, created_at')
            .eq('tipo', 'saida')
            .gte('created_at', inicio.toISOString());
        if (error) throw error;

        const soma = {};
        (data || []).forEach(m => { soma[m.produto_id] = (soma[m.produto_id] || 0) + m.quantidade; });

        const nDias = contarDiasConsiderados(periodo, dias);
        const divisor = nDias > 0 ? nDias : periodo;

        cache.consumoCalc = {};
        Object.keys(soma).forEach(pid => {
            cache.consumoCalc[pid] = soma[pid] / divisor;
        });
    } catch (e) {
        console.warn('Erro ao calcular consumos:', e);
        cache.consumoCalc = cache.consumoCalc || {};
    }
}

// Consumo diário efetivo de um produto (manual fixo, ou calculado)
function consumoEfetivo(p) {
    if ((p.consumo_modo || 'automatico') === 'manual') return p.consumo_diario || 0;
    const c = cache.consumoCalc ? cache.consumoCalc[p.id] : undefined;
    return (typeof c === 'number') ? c : 0;
}

function montarItensCompra() {
    const margemFator = 1 + comprasMargem / 100;
    const mapa = {};

    // 1) Reposição guiada por dias de cobertura (todos os produtos com consumo > 0).
    //    necessário = consumo × dias × (1 + margem%), arredondado pra cima.
    //    comprar = necessário − estoque (só entra quem tem falta).
    cache.produtos.forEach(p => {
        const consumoDiario = consumoEfetivo(p);
        if (consumoDiario > 0) {
            const necessario = Math.ceil(consumoDiario * comprasDias * margemFator);
            const comprar = Math.max(0, necessario - p.estoque);
            if (comprar > 0) {
                const key = 'prod-' + p.id;
                mapa[key] = {
                    key, produtoId: p.id, nome: p.nome, icone: p.icone,
                    categoria: p.categorias?.nome || null,
                    estoque: p.estoque, consumoDiario, comprar,
                    diasCobertura: consumoDiario > 0 ? p.estoque / consumoDiario : Infinity,
                    origens: ['reposicao'], justificativas: [], editavel: false
                };
            }
        }
    });

    // 2) Alertas aceitos
    cache.alertas.filter(a => a.status === 'aceito').forEach(a => {
        if (a.produto_id) {
            const key = 'prod-' + a.produto_id;
            if (mapa[key]) {
                if (!mapa[key].origens.includes('alerta')) mapa[key].origens.push('alerta');
                if (a.descricao) mapa[key].justificativas.push(a.descricao);
            } else {
                const p = cache.produtos.find(x => x.id === a.produto_id);
                if (p) {
                    const consumoDiario = consumoEfetivo(p);
                    const necessario = Math.ceil(consumoDiario * comprasDias * margemFator);
                    mapa[key] = {
                        key, produtoId: p.id, nome: p.nome, icone: p.icone,
                        categoria: p.categorias?.nome || null, estoque: p.estoque,
                        consumoDiario, comprar: Math.max(1, necessario - p.estoque),
                        diasCobertura: consumoDiario > 0 ? p.estoque / consumoDiario : Infinity,
                        origens: ['alerta'], justificativas: a.descricao ? [a.descricao] : [], editavel: false
                    };
                }
            }
        } else {
            const key = 'alerta-' + a.id;
            mapa[key] = {
                key, produtoId: null, nome: a.produtos?.nome || 'Alerta geral',
                icone: a.produtos?.icone || '⚠️', categoria: null,
                estoque: null, consumoDiario: null,
                comprar: comprasQtd[key] ?? 1, diasCobertura: Infinity,
                origens: ['alerta'], justificativas: a.descricao ? [a.descricao] : [], editavel: true
            };
        }
    });

    // 3) Sugestões aprovadas (produto novo)
    cache.sugestoes.filter(s => s.status === 'aprovada').forEach(s => {
        const key = 'sug-' + s.id;
        mapa[key] = {
            key, produtoId: null, nome: s.nome,
            icone: s.categorias?.icone || '💡',
            categoria: s.categorias?.nome || null,
            estoque: null, consumoDiario: null,
            comprar: comprasQtd[key] ?? 1, diasCobertura: Infinity,
            origens: ['sugestao'], justificativas: s.justificativa ? [s.justificativa] : [], editavel: true
        };
    });

    return Object.values(mapa);
}

function itensCompraFiltradosOrdenados() {
    let itens = montarItensCompra();
    if (comprasFiltroTag !== 'todas') {
        itens = itens.filter(i => i.origens.includes(comprasFiltroTag));
    }
    if (comprasFiltroCategoria !== 'todas') {
        itens = itens.filter(i => (i.categoria || '') === comprasFiltroCategoria);
    }
    const ordemEtiqueta = { reposicao: 0, alerta: 1, sugestao: 2 };
    itens.sort((a, b) => {
        switch (comprasOrdem) {
            case 'alfabetica': return a.nome.localeCompare(b.nome);
            case 'categoria':  return (a.categoria || 'zzz').localeCompare(b.categoria || 'zzz') || a.nome.localeCompare(b.nome);
            case 'comprar':    return (b.comprar || 0) - (a.comprar || 0);
            case 'etiqueta': {
                const ia = Math.min(...a.origens.map(o => ordemEtiqueta[o]));
                const ib = Math.min(...b.origens.map(o => ordemEtiqueta[o]));
                return ia - ib || a.nome.localeCompare(b.nome);
            }
            default:           return a.diasCobertura - b.diasCobertura; // cobertura
        }
    });
    return itens;
}

function setComprasFiltro(tag) { comprasFiltroTag = tag; renderPage(); }
function setComprasFiltroCategoria(cat) { comprasFiltroCategoria = cat; renderPage(); }
function setComprasOrdem(ordem) { comprasOrdem = ordem; renderPage(); }
function setCompraQtd(key, valor) {
    const n = parseInt(valor);
    comprasQtd[key] = (!isNaN(n) && n >= 0) ? n : 0;
}

// ----- Fluxo "Comprei" (fecha o ciclo de compras) -----
function comprarItem(key) {
    const item = montarItensCompra().find(i => i.key === key);
    if (!item) { showToast('Item não encontrado, recarregue a tela.', 'error'); return; }

    if (key.startsWith('sug-')) {
        // Sugestão de produto novo → abre cadastro pré-preenchido
        abrirCadastroDeSugestao(parseInt(key.replace('sug-', '')), item);
        return;
    }
    if (!item.produtoId) {
        // Alerta geral sem produto → só marca como comprado
        marcarAlertaComprado(parseInt(key.replace('alerta-', '')));
        return;
    }
    // Produto existente → confirma quantidade e dá entrada no estoque
    abrirConfirmarCompra(item);
}

function abrirConfirmarCompra(item) {
    const body = `
        <p style="color: var(--gray-600); margin-bottom: 12px;">
            Confirmar a compra de <strong>${item.nome}</strong>? Isso dá entrada no estoque e tira o item da lista.
        </p>
        <div class="form-group">
            <label>Quantidade recebida</label>
            <input type="number" id="compra-qtd" class="form-input" value="${item.comprar}" min="1">
        </div>
    `;
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-success" onclick="confirmarCompraProduto(${item.produtoId})">Confirmar compra</button>
    `;
    openModal('Comprei — ' + item.nome, body, footer);
}

async function confirmarCompraProduto(produtoId) {
    const qtd = parseInt(document.getElementById('compra-qtd')?.value) || 0;
    if (qtd <= 0) { showToast('Informe a quantidade recebida', 'error'); return; }
    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }

    try {
        const { error } = await supabaseClient.rpc('registrar_movimentacao', {
            p_produto_id: Number(produtoId),
            p_user_id: userId,
            p_tipo: 'entrada',
            p_quantidade: qtd,
            p_observacao: 'Compra registrada'
        });
        if (error) { console.error('Erro Supabase confirmarCompraProduto:', error); throw error; }

        // Marca alertas aceitos desse produto como comprado (saem da lista)
        await supabaseClient.from('alertas')
            .update({ status: 'comprado' })
            .eq('produto_id', produtoId)
            .eq('status', 'aceito');

        showToast('Compra registrada! Estoque atualizado.', 'success');
        closeModal();
        await loadProdutos();
        await loadAlertas();
        renderPage();
    } catch (error) {
        console.error('Erro ao registrar compra:', error);
        showToast('Erro ao registrar compra: ' + (error.message || 'verifique o console'), 'error');
    }
}

async function marcarAlertaComprado(alertaId) {
    try {
        const { error } = await supabaseClient.from('alertas')
            .update({ status: 'comprado' })
            .eq('id', alertaId);
        if (error) { console.error('Erro Supabase marcarAlertaComprado:', error); throw error; }
        showToast('Item marcado como comprado', 'success');
        await loadAlertas();
        renderPage();
    } catch (error) {
        console.error('Erro ao marcar comprado:', error);
        showToast('Erro: ' + (error.message || 'verifique o console'), 'error');
    }
}

function abrirCadastroDeSugestao(sugId, item) {
    const body = `
        <p style="color: var(--gray-600); margin-bottom: 12px;">
            Cadastre o produto da sugestão para adicioná-lo ao estoque:
        </p>
        <div class="form-group">
            <label>Nome *</label>
            <input type="text" id="sug-prod-nome" class="form-input" value="${item.nome.replace(/"/g, '&quot;')}">
        </div>
        <div class="form-group">
            <label>Ícone (emoji)</label>
            <input type="text" id="sug-prod-icone" class="form-input" value="${item.icone || '📦'}" maxlength="2">
        </div>
        <div class="form-group">
            <label>Categoria *</label>
            <select id="sug-prod-categoria" class="form-input">
                <option value="">Selecione...</option>
                ${cache.categorias.map(c => `<option value="${c.id}" ${item.categoria === c.nome ? 'selected' : ''}>${c.icone} ${c.nome}</option>`).join('')}
            </select>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="form-group">
                <label>Estoque inicial</label>
                <input type="number" id="sug-prod-estoque" class="form-input" value="${item.comprar || 0}" min="0">
            </div>
            <div class="form-group">
                <label>Estoque mínimo</label>
                <input type="number" id="sug-prod-minimo" class="form-input" value="10" min="1">
            </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="form-group">
                <label>Unidade</label>
                <select id="sug-prod-unidade" class="form-input">
                    <option value="un">Unidade (un)</option>
                    <option value="cx">Caixa (cx)</option>
                    <option value="pct">Pacote (pct)</option>
                    <option value="kg">Quilograma (kg)</option>
                    <option value="lt">Litro (lt)</option>
                    <option value="mt">Metro (mt)</option>
                    <option value="rl">Rolo (rl)</option>
                </select>
            </div>
            <div class="form-group">
                <label>Consumo Diário</label>
                <input type="number" id="sug-prod-consumo" class="form-input" value="1" min="0" step="0.1">
            </div>
        </div>
    `;
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-success" onclick="criarProdutoDeSugestao(${sugId})">Cadastrar e concluir</button>
    `;
    openModal('Comprei — novo produto', body, footer);
}

async function criarProdutoDeSugestao(sugId) {
    const nome = document.getElementById('sug-prod-nome').value.trim();
    const categoria = document.getElementById('sug-prod-categoria').value;
    if (!nome) { showToast('Digite o nome do produto', 'error'); return; }
    if (!categoria) { showToast('Selecione uma categoria', 'error'); return; }

    const dados = {
        nome,
        icone: document.getElementById('sug-prod-icone').value.trim() || '📦',
        categoria_id: parseInt(categoria),
        estoque: parseInt(document.getElementById('sug-prod-estoque').value) || 0,
        estoque_minimo: parseInt(document.getElementById('sug-prod-minimo').value) || 10,
        unidade: document.getElementById('sug-prod-unidade').value,
        consumo_diario: parseFloat(document.getElementById('sug-prod-consumo').value) || 1,
        ativo: true
    };

    try {
        const { error } = await supabaseClient.from('produtos').insert(dados);
        if (error) { console.error('Erro Supabase criarProdutoDeSugestao:', error); throw error; }

        await supabaseClient.from('sugestoes').update({ status: 'comprada' }).eq('id', sugId);

        showToast('Produto cadastrado e sugestão concluída!', 'success');
        closeModal();
        await loadProdutos();
        await loadSugestoes();
        renderPage();
    } catch (error) {
        console.error('Erro ao cadastrar produto da sugestão:', error);
        showToast('Erro ao cadastrar: ' + (error.message || 'verifique o console'), 'error');
    }
}

// ============================================
// IMPORTAÇÃO DE NOTA (XML da NF-e) — Etapa 1
// ============================================
let importNotaItens = [];

function dispararImportNota() {
    const input = document.getElementById('arquivo-nota');
    if (input) input.click();
}

async function lerNotaXML(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const texto = await file.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(texto, 'application/xml');

        if (xml.getElementsByTagName('parsererror').length > 0) {
            showToast('Arquivo XML inválido.', 'error');
            return;
        }

        const dets = xml.getElementsByTagName('det');
        if (!dets || dets.length === 0) {
            showToast('Não encontrei produtos nesse XML. É uma NF-e?', 'error');
            return;
        }

        const txt = (parent, tag) => {
            const el = parent.getElementsByTagName(tag)[0];
            return el ? (el.textContent || '').trim() : '';
        };

        const itens = [];
        for (let i = 0; i < dets.length; i++) {
            const prod = dets[i].getElementsByTagName('prod')[0];
            if (!prod) continue;
            let ean = txt(prod, 'cEAN') || txt(prod, 'cEANTrib');
            if (/sem\s*gtin/i.test(ean)) ean = '';
            itens.push({
                idx: i,
                codigoFornecedor: txt(prod, 'cProd'),
                ean: ean,
                descricao: txt(prod, 'xProd'),
                unidade: txt(prod, 'uCom'),
                quantidade: Math.max(1, Math.round(parseFloat(txt(prod, 'qCom').replace(',', '.')) || 0)),
                fator: 1,
                quantidadeFinal: 0,
                produtoId: null,
                origem: null
            });
        }

        // Carregar vínculos aprendidos
        await loadVinculosNf();
        casarItensNota(itens);
        importNotaItens = itens;
        mostrarPreviaNota();
    } catch (err) {
        console.error('Erro ao ler XML da nota:', err);
        showToast('Não foi possível ler o arquivo: ' + (err.message || ''), 'error');
    } finally {
        event.target.value = '';
    }
}

async function loadVinculosNf() {
    try {
        const { data, error } = await supabaseClient.from('vinculos_nf').select('*');
        if (error) { console.warn('Erro ao carregar vínculos:', error); cache.vinculosNf = []; return; }
        cache.vinculosNf = data || [];
    } catch (e) { cache.vinculosNf = []; }
}

function unidadeDeNota(u) {
    const map = {
        un: 'un', und: 'un', unid: 'un', unidade: 'un', pç: 'un', pca: 'un',
        pc: 'pct', pct: 'pct', pcte: 'pct', pacote: 'pct',
        cx: 'cx', caixa: 'cx', cxa: 'cx',
        kg: 'kg', g: 'kg', grama: 'kg',
        l: 'lt', lt: 'lt', litro: 'lt',
        m: 'mt', mt: 'mt', metro: 'mt',
        rl: 'rl', rolo: 'rl', rolos: 'rl'
    };
    return map[(u || '').toLowerCase().trim()] || 'un';
}

function setQtdFinalNota(idx, valor) {
    const item = importNotaItens.find(i => i.idx === idx);
    if (!item) return;
    const n = parseInt(valor);
    item.quantidadeFinal = (!isNaN(n) && n >= 0) ? n : 0;
}

function casarItensNota(itens) {
    const vinculos = cache.vinculosNf || [];
    itens.forEach(item => {
        item.produtoId = null;
        item.origem = null;
        item.fator = 1;
        // 1) por EAN no produto
        if (item.ean) {
            const p = cache.produtos.find(x => (x.ean || '') === item.ean);
            if (p) { item.produtoId = p.id; item.origem = 'ean'; item.fator = p.fator_embalagem || 1; }
        }
        // 2) por vínculo aprendido (EAN ou código do fornecedor)
        if (!item.produtoId) {
            const v = vinculos.find(v =>
                (item.ean && v.codigo_nf === item.ean) ||
                (item.codigoFornecedor && v.codigo_nf === item.codigoFornecedor)
            );
            if (v) {
                const p = cache.produtos.find(x => x.id === v.produto_id);
                if (p) { item.produtoId = p.id; item.origem = 'vinculo'; item.fator = p.fator_embalagem || 1; }
            }
        }
        // Quantidade final = quantidade da nota × fator da embalagem
        item.quantidadeFinal = item.quantidade * (item.fator || 1);
    });
}

function nomeProduto(id) {
    const p = cache.produtos.find(x => x.id === id);
    return p ? `${p.icone || '📦'} ${p.nome}` : '—';
}

function mostrarPreviaNota() {
    const reconhecidos = importNotaItens.filter(i => i.produtoId);
    const desconhecidos = importNotaItens.filter(i => !i.produtoId);

    const linhaRec = (i) => `
        <div style="padding:8px 0; border-bottom:1px solid var(--gray-100,#eee); font-size:13px;">
            <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                <span><strong>${nomeProduto(i.produtoId)}</strong></span>
                <span style="display:flex; gap:8px; align-items:center; white-space:nowrap;">
                    <input type="number" min="0" value="${i.quantidadeFinal}" title="Quantidade que entra no estoque" onchange="setQtdFinalNota(${i.idx}, this.value)" style="width:60px; text-align:center; padding:4px; border:1px solid var(--gray-300,#ccc); border-radius:6px;">
                    <button class="btn btn-secondary btn-sm" style="padding:4px 8px;" onclick="abrirVincularItemNota(${i.idx})">trocar</button>
                </span>
            </div>
            <div style="color:var(--gray-500);">Nota: ${i.quantidade} ${i.unidade || ''}${(i.fator > 1) ? ` × ${i.fator} = ${i.quantidade * i.fator} un` : ''} • ${i.descricao}</div>
        </div>`;

    const linhaDesc = (i) => `
        <div style="padding:8px 0; border-bottom:1px solid var(--gray-100,#eee); font-size:13px;">
            <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                <span>${i.descricao}<br><span style="color:var(--gray-500);">${i.ean ? 'EAN ' + i.ean : 'sem EAN'} • Qtd ${i.quantidade}</span></span>
                <span style="display:flex; gap:6px; white-space:nowrap;">
                    <button class="btn btn-secondary btn-sm" style="padding:4px 8px;" onclick="abrirVincularItemNota(${i.idx})">Vincular</button>
                    <button class="btn btn-primary btn-sm" style="padding:4px 8px;" onclick="abrirCriarProdutoNota(${i.idx})">Criar</button>
                </span>
            </div>
        </div>`;

    const body = `
        <p style="color: var(--gray-600); margin-bottom: 12px;">
            ${reconhecidos.length} reconhecido(s) · ${desconhecidos.length} não reconhecido(s).
            Os não vinculados serão ignorados nesta importação.
        </p>
        ${reconhecidos.length ? `
            <div style="margin-bottom:14px;">
                <div style="font-weight:600; color:var(--success); margin-bottom:4px;">✓ Reconhecidos (${reconhecidos.length})</div>
                ${reconhecidos.map(linhaRec).join('')}
            </div>` : ''}
        ${desconhecidos.length ? `
            <div style="margin-bottom:14px;">
                <div style="font-weight:600; color:var(--gray-600); margin-bottom:4px;">Não reconhecidos (${desconhecidos.length})</div>
                ${desconhecidos.map(linhaDesc).join('')}
            </div>` : ''}
    `;
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        ${reconhecidos.length ? `<button class="btn btn-success" onclick="confirmarImportacaoNota()">Dar entrada (${reconhecidos.length})</button>` : ''}
    `;
    openModal('Importar nota (XML)', body, footer);
}

function abrirVincularItemNota(idx) {
    const item = importNotaItens.find(i => i.idx === idx);
    if (!item) return;
    const produtos = [...cache.produtos].sort((a, b) => a.nome.localeCompare(b.nome));
    const body = `
        <p style="color: var(--gray-600); margin-bottom: 10px;">Vincular o item da nota a um produto seu:</p>
        <div style="background:var(--gray-100,#f5f5f5); padding:8px 10px; border-radius:8px; font-size:13px; margin-bottom:12px;">
            <strong>${item.descricao}</strong><br>
            <span style="color:var(--gray-500);">${item.ean ? 'EAN ' + item.ean : 'sem EAN'} • Qtd ${item.quantidade}</span>
        </div>
        <div class="form-group">
            <label>Produto</label>
            <select id="vinc-produto" class="form-input">
                <option value="">Selecione...</option>
                ${produtos.map(p => `<option value="${p.id}">${p.icone || '📦'} ${p.nome}</option>`).join('')}
            </select>
        </div>
        <p style="color: var(--gray-500); font-size:12px;">O vínculo será salvo: nas próximas notas, esse item será reconhecido automaticamente.</p>
    `;
    const footer = `
        <button class="btn btn-secondary" onclick="mostrarPreviaNota()">Voltar</button>
        <button class="btn btn-primary" onclick="confirmarVinculoItemNota(${idx})">Vincular</button>
    `;
    openModal('Vincular item', body, footer);
}

async function confirmarVinculoItemNota(idx) {
    const item = importNotaItens.find(i => i.idx === idx);
    if (!item) return;
    const produtoId = parseInt(document.getElementById('vinc-produto').value);
    if (!produtoId) { showToast('Selecione um produto', 'error'); return; }

    try {
        // Aprender o vínculo: salva o EAN no produto (se houver) e registra de-para
        if (item.ean) {
            // Garante que o EAN fique só no produto escolhido (corrige vínculo trocado)
            await supabaseClient.from('produtos').update({ ean: null }).eq('ean', item.ean).neq('id', produtoId);
            await supabaseClient.from('produtos').update({ ean: item.ean }).eq('id', produtoId);
            await supabaseClient.from('vinculos_nf').upsert(
                { codigo_nf: item.ean, tipo: 'ean', produto_id: produtoId },
                { onConflict: 'codigo_nf,tipo' }
            );
        }
        if (item.codigoFornecedor) {
            await supabaseClient.from('vinculos_nf').upsert(
                { codigo_nf: item.codigoFornecedor, tipo: 'fornecedor', produto_id: produtoId },
                { onConflict: 'codigo_nf,tipo' }
            );
        }
        await loadProdutos();
        await loadVinculosNf();

        // Marca como reconhecido na prévia
        item.produtoId = produtoId;
        item.origem = 'manual';
        const pVinc = cache.produtos.find(x => x.id === produtoId);
        item.fator = pVinc?.fator_embalagem || 1;
        item.quantidadeFinal = item.quantidade * item.fator;

        showToast('Vínculo salvo!', 'success');
        mostrarPreviaNota();
    } catch (error) {
        console.error('Erro ao vincular item:', error);
        showToast('Erro ao vincular: ' + (error.message || 'verifique o console'), 'error');
    }
}

function abrirCriarProdutoNota(idx) {
    const item = importNotaItens.find(i => i.idx === idx);
    if (!item) return;
    const body = `
        <div class="form-group">
            <label>Nome *</label>
            <input type="text" id="nota-prod-nome" class="form-input" value="${(item.descricao || '').replace(/"/g, '&quot;')}">
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="form-group">
                <label>Código de barras (EAN)</label>
                <input type="text" id="nota-prod-ean" class="form-input" value="${item.ean || ''}">
            </div>
            <div class="form-group">
                <label>Estoque inicial</label>
                <input type="number" id="nota-prod-estoque" class="form-input" value="${item.quantidade}" min="0">
            </div>
        </div>
        <div class="form-group">
            <label>Categoria *</label>
            <select id="nota-prod-categoria" class="form-input">
                <option value="">Selecione...</option>
                ${cache.categorias.map(c => `<option value="${c.id}">${c.icone} ${c.nome}</option>`).join('')}
            </select>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="form-group">
                <label>Estoque mínimo</label>
                <input type="number" id="nota-prod-minimo" class="form-input" value="10" min="1">
            </div>
            <div class="form-group">
                <label>Consumo diário</label>
                <input type="number" id="nota-prod-consumo" class="form-input" value="1" min="0" step="0.1">
            </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="form-group">
                <label>Unidade</label>
                <select id="nota-prod-unidade" class="form-input">
                    ${['un', 'cx', 'pct', 'kg', 'lt', 'mt', 'rl'].map(u => `<option value="${u}" ${unidadeDeNota(item.unidade) === u ? 'selected' : ''}>${u}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Unid. por embalagem</label>
                <input type="number" id="nota-prod-fator" class="form-input" value="1" min="1" title="Ex: 1 caixa = 10 unidades → 10">
            </div>
        </div>
        <div class="form-group">
            <label>Ícone</label>
            <input type="text" id="nota-prod-icone" class="form-input" value="📦" maxlength="2" style="text-align:center;">
        </div>
    `;
    const footer = `
        <button class="btn btn-secondary" onclick="mostrarPreviaNota()">Voltar</button>
        <button class="btn btn-success" onclick="criarProdutoDaNota(${idx})">Criar e voltar</button>
    `;
    openModal('Criar produto da nota', body, footer);
}

async function criarProdutoDaNota(idx) {
    const item = importNotaItens.find(i => i.idx === idx);
    if (!item) return;
    const nome = document.getElementById('nota-prod-nome').value.trim();
    const categoria = document.getElementById('nota-prod-categoria').value;
    const ean = document.getElementById('nota-prod-ean').value.trim() || null;
    const estoqueInicial = Math.max(0, parseInt(document.getElementById('nota-prod-estoque').value) || 0);
    const fator = Math.max(1, parseInt(document.getElementById('nota-prod-fator').value) || 1);

    if (!nome) { showToast('Digite o nome do produto', 'error'); return; }
    if (!categoria) { showToast('Selecione uma categoria', 'error'); return; }

    try {
        // Cria com estoque 0; a quantidade entra como movimentação no "Confirmar"
        // (assim a entrada fica registrada no histórico e não há contagem dupla)
        const { data, error } = await supabaseClient.from('produtos').insert({
            nome,
            ean,
            icone: document.getElementById('nota-prod-icone').value.trim() || '📦',
            categoria_id: parseInt(categoria),
            estoque: 0,
            estoque_minimo: parseInt(document.getElementById('nota-prod-minimo').value) || 10,
            unidade: document.getElementById('nota-prod-unidade').value,
            consumo_diario: parseFloat(document.getElementById('nota-prod-consumo').value) || 1,
            fator_embalagem: fator,
            ativo: true
        }).select().single();
        if (error) { console.error('Erro Supabase criarProdutoDaNota:', error); throw error; }

        // Aprende o vínculo para as próximas notas
        if (ean) {
            await supabaseClient.from('vinculos_nf').upsert(
                { codigo_nf: ean, tipo: 'ean', produto_id: data.id }, { onConflict: 'codigo_nf,tipo' });
        }
        if (item.codigoFornecedor) {
            await supabaseClient.from('vinculos_nf').upsert(
                { codigo_nf: item.codigoFornecedor, tipo: 'fornecedor', produto_id: data.id }, { onConflict: 'codigo_nf,tipo' });
        }

        await loadProdutos();
        await loadVinculosNf();

        // Marca como reconhecido; a entrada (estoque inicial) acontece no Confirmar
        item.produtoId = data.id;
        item.origem = 'criado';
        item.fator = fator;
        item.quantidade = estoqueInicial;
        item.quantidadeFinal = estoqueInicial;

        showToast('Produto criado!', 'success');
        mostrarPreviaNota();
    } catch (error) {
        console.error('Erro ao criar produto da nota:', error);
        showToast('Erro ao criar produto: ' + (error.message || 'verifique o console'), 'error');
    }
}

async function confirmarImportacaoNota() {
    const reconhecidos = importNotaItens.filter(i => i.produtoId);
    if (reconhecidos.length === 0) { showToast('Nenhum item reconhecido para dar entrada.', 'error'); return; }
    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }

    try {
        for (const item of reconhecidos) {
            const qtdEntrada = (typeof item.quantidadeFinal === 'number') ? item.quantidadeFinal : item.quantidade;
            if (qtdEntrada > 0) {
                // Soma ao estoque (atômico)
                const { error } = await supabaseClient.rpc('registrar_movimentacao', {
                    p_produto_id: Number(item.produtoId),
                    p_user_id: userId,
                    p_tipo: 'entrada',
                    p_quantidade: qtdEntrada,
                    p_observacao: 'Entrada por nota (XML)'
                });
                if (error) { console.error('Erro ao dar entrada (nota):', error); throw error; }
            }

            // Baixa na lista de compras: alertas aceitos desse produto viram comprado
            await supabaseClient.from('alertas')
                .update({ status: 'comprado' })
                .eq('produto_id', item.produtoId)
                .eq('status', 'aceito');
        }

        showToast(`Entrada concluída: ${reconhecidos.length} item(ns) atualizados.`, 'success');
        importNotaItens = [];
        closeModal();
        await loadProdutos();
        await loadAlertas();
        renderPage();
    } catch (error) {
        console.error('Erro na importação da nota:', error);
        showToast('Erro na importação: ' + (error.message || 'verifique o console'), 'error');
    }
}

function renderComprasConteudo() {
    const itens = itensCompraFiltradosOrdenados();

    const categoriasUnicas = [...new Set(montarItensCompra().map(i => i.categoria).filter(Boolean))].sort();

    const filtros = `
        <div class="card mb-4">
            <div class="config-grid">
                <div class="config-item">
                    <label>Filtrar por etiqueta</label>
                    <select class="form-input" onchange="setComprasFiltro(this.value)">
                        <option value="todas" ${comprasFiltroTag === 'todas' ? 'selected' : ''}>Todas</option>
                        <option value="reposicao" ${comprasFiltroTag === 'reposicao' ? 'selected' : ''}>Reposição</option>
                        <option value="alerta" ${comprasFiltroTag === 'alerta' ? 'selected' : ''}>Alerta</option>
                        <option value="sugestao" ${comprasFiltroTag === 'sugestao' ? 'selected' : ''}>Sugestão</option>
                    </select>
                </div>
                <div class="config-item">
                    <label>Filtrar por categoria</label>
                    <select class="form-input" onchange="setComprasFiltroCategoria(this.value)">
                        <option value="todas" ${comprasFiltroCategoria === 'todas' ? 'selected' : ''}>Todas</option>
                        ${categoriasUnicas.map(c => `<option value="${c}" ${comprasFiltroCategoria === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </div>
                <div class="config-item">
                    <label>Organizar por</label>
                    <select class="form-input" onchange="setComprasOrdem(this.value)">
                        <option value="cobertura" ${comprasOrdem === 'cobertura' ? 'selected' : ''}>Dias de cobertura (mais urgente)</option>
                        <option value="alfabetica" ${comprasOrdem === 'alfabetica' ? 'selected' : ''}>Ordem alfabética</option>
                        <option value="categoria" ${comprasOrdem === 'categoria' ? 'selected' : ''}>Categoria</option>
                        <option value="comprar" ${comprasOrdem === 'comprar' ? 'selected' : ''}>Quantidade a comprar</option>
                        <option value="etiqueta" ${comprasOrdem === 'etiqueta' ? 'selected' : ''}>Etiqueta</option>
                    </select>
                </div>
            </div>

            <div class="config-grid" style="margin-top:12px; align-items:end;">
                <div class="config-item">
                    <label>Dias de Cobertura</label>
                    <input type="number" id="dias-cobertura" value="${comprasDias}" min="1">
                    <small>Estoque para quantos dias</small>
                </div>
                <div class="config-item">
                    <label>Margem de Segurança</label>
                    <input type="number" id="margem-seguranca" value="${comprasMargem}" min="0">
                    <small>% adicional</small>
                </div>
                <div class="config-item">
                    <button class="btn btn-primary" style="width:100%;" onclick="setComprasConfig()">🔄 Recalcular</button>
                </div>
            </div>
        </div>
    `;

    if (itens.length === 0) {
        return filtros + `
            <div class="empty-state">
                <div class="icon">✅</div>
                <h3>Nada para comprar</h3>
                <p>Nenhum item ${comprasFiltroTag !== 'todas' ? 'com essa etiqueta' : 'no momento'}.</p>
            </div>`;
    }

    const acoes = `
        <div class="page-actions mb-4" style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" onclick="exportComprasPDF()">📄 PDF</button>
            <button class="btn btn-secondary btn-sm" onclick="exportComprasExcel()">📊 Excel</button>
            <button class="btn btn-primary btn-sm" onclick="dispararImportNota()">📥 Importar nota (XML)</button>
            <input type="file" id="arquivo-nota" accept=".xml" style="display:none" onchange="lerNotaXML(event)">
        </div>`;

    const lista = itens.map(item => {
        const tagsHtml = item.origens.map(o => {
            const t = COMPRA_TAGS[o];
            return `<span style="font-size:11px; font-weight:600; color:${t.cor}; background:${t.bg}; padding:2px 8px; border-radius:10px;">${t.label}</span>`;
        }).join(' ');

        const justi = item.justificativas.length
            ? `<div style="font-size:13px; color:var(--gray-600); margin-top:4px;"><em>"${item.justificativas.join('" • "')}"</em></div>` : '';

        const info = item.estoque !== null
            ? `Estoque: ${item.estoque} • ${item.consumoDiario}/${item.unidade || 'un'}/dia • ~${item.diasCobertura === Infinity ? '∞' : Math.round(item.diasCobertura)} dias`
            : 'Produto novo (sem estoque)';

        const qtdHtml = item.editavel
            ? `<input type="number" min="0" value="${item.comprar}" onchange="setCompraQtd('${item.key}', this.value)" style="width:64px; text-align:center; padding:6px; border:1px solid var(--gray-300,#ccc); border-radius:8px;">`
            : `<div class="value" style="font-size:20px; font-weight:700;">${item.comprar}</div>`;

        return `
            <div class="shopping-item" style="align-items:flex-start;">
                <div class="shopping-item-icon">${item.icone}</div>
                <div class="shopping-item-info">
                    <div class="shopping-item-name">${item.nome} ${tagsHtml}</div>
                    <div class="shopping-item-meta">${info}</div>
                    ${justi}
                </div>
                <div class="shopping-item-qty" style="text-align:center;">
                    ${qtdHtml}
                    <div class="unit" style="font-size:11px; color:var(--gray-500);">comprar</div>
                    <button class="btn btn-success btn-sm" style="margin-top:6px; padding:6px 10px;" onclick="comprarItem('${item.key}')">✓ Comprei</button>
                </div>
            </div>`;
    }).join('');

    return acoes + filtros + `<div id="lista-compras">${lista}</div>`;
}

// ============================================
// RENDERIZAÇÃO - RELATÓRIOS
// ============================================
function renderRelatorios() {
    const btns = (fn) => `
        <div class="list-item-right" style="display:flex; gap:6px;">
            <button class="btn btn-secondary btn-sm" onclick="${fn}('pdf')">📄 PDF</button>
            <button class="btn btn-secondary btn-sm" onclick="${fn}('excel')">📊 Excel</button>
        </div>`;
    return `
        <div class="page-header">
            <div class="page-title">Relatórios</div>
            <div class="page-subtitle">Gere relatórios em PDF ou Excel</div>
        </div>
        
        <div class="card">
            <div class="card-title">📊 Relatórios</div>
            
            <div class="list-item" style="cursor:default;">
                <div class="list-item-icon">📦</div>
                <div class="list-item-content">
                    <div class="list-item-title">Relatório de Estoque</div>
                    <div class="list-item-subtitle">Posição atual de todos os produtos</div>
                </div>
                ${btns('gerarRelatorioEstoque')}
            </div>
            
            <div class="list-item" style="cursor:default;">
                <div class="list-item-icon">📈</div>
                <div class="list-item-content">
                    <div class="list-item-title">Relatório de Consumo</div>
                    <div class="list-item-subtitle">Movimentações e consumo por produto</div>
                </div>
                ${btns('gerarRelatorioConsumo')}
            </div>
        </div>
        
        <div class="card">
            <div class="card-title">💾 Backup completo</div>
            <p style="color: var(--gray-500); font-size: 14px; margin-bottom: 12px;">
                Exporta <strong>todos os dados</strong> do sistema (produtos, movimentações, fornecedores, etc.) num único arquivo — útil para backup ou análise externa. Diferente dos relatórios acima, que são focados em um tema específico.
            </p>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                <button class="btn btn-secondary" onclick="exportarTudoExcel()">📊 Backup em Excel</button>
                <button class="btn btn-secondary" onclick="exportarTudoPDF()">📄 Backup em PDF</button>
            </div>
        </div>
    `;
}

// ============================================
// RENDERIZAÇÃO - MAIS (MOBILE)
// ============================================
function renderMais() {
    const isAdmin = currentProfile?.role === 'admin';
    
    return `
        <div class="page-header">
            <div class="page-title">Mais Opções</div>
        </div>
        
        <div class="card">
            <div class="card-title">📂 Menu</div>
            
            ${isAdmin ? `
            <div class="sidebar-item" onclick="navigate('estoque')">
                <span class="icon">📊</span>
                <span>Estoque</span>
            </div>` : ''}
            <div class="sidebar-item" onclick="navigate('historico')">
                <span class="icon">📜</span>
                <span>Histórico</span>
            </div>
            <div class="sidebar-item" onclick="navigate('sugestoes')">
                <span class="icon">💡</span>
                <span>Sugestões</span>
            </div>
            
            ${isAdmin ? `
                <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--gray-200);">
                    <div class="sidebar-section-title" style="padding: 0; margin-bottom: 12px;">Administração</div>
                    
                    <div class="sidebar-item" onclick="navigate('fornecedores')">
                        <span class="icon">🏪</span>
                        <span>Fornecedores</span>
                    </div>
                    <div class="sidebar-item" onclick="navigate('categorias')">
                        <span class="icon">🏷️</span>
                        <span>Categorias</span>
                    </div>
                    <div class="sidebar-item" onclick="navigate('configuracoes')">
                        <span class="icon">⚙️</span>
                        <span>Configurações</span>
                    </div>
                    <div class="sidebar-item" onclick="navigate('relatorios')">
                        <span class="icon">📈</span>
                        <span>Relatórios</span>
                    </div>
                </div>
            ` : ''}
        </div>
        
        <div class="card">
            <div class="card-title">👤 Conta</div>
            
            <div class="list-item" style="cursor: default;">
                <div class="avatar">${currentProfile?.nome?.charAt(0) || 'U'}</div>
                <div class="list-item-content">
                    <div class="list-item-title">${currentProfile?.nome || 'Usuário'}</div>
                    <div class="list-item-subtitle">${currentUser?.email}</div>
                </div>
                <span class="badge ${isAdmin ? 'badge-info' : 'badge-success'}">${isAdmin ? 'Admin' : 'Colaborador'}</span>
            </div>
            
            <button class="btn btn-secondary mt-4" onclick="openPerfilModal()">⚙️ Meu Perfil</button>
            <button class="btn btn-danger mt-2" onclick="confirmLogout()">Sair da Conta</button>
        </div>
    `;
}

// ============================================
// MODAIS
// ============================================
function openModal(title, bodyHtml, footerHtml = null) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    
    if (footerHtml !== null) {
        document.getElementById('modal-footer').innerHTML = footerHtml;
        document.getElementById('modal-footer').style.display = 'flex';
    } else {
        document.getElementById('modal-footer').style.display = 'none';
    }
    
    document.getElementById('modal').classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('modal').classList.remove('show');
    document.body.style.overflow = '';
    selectedProduct = null;
    selectedQty = 1;
    modalCallback = null;
}

function closeModalOutside(event) {
    if (event.target.classList.contains('modal-overlay')) {
        closeModal();
    }
}

// Modal de Produto
async function openProductModal(productId) {
    const produto = cache.produtos.find(p => p.id === productId);
    if (!produto) return;
    
    selectedProduct = produto;
    selectedQty = 1;
    
    const userRating = cache.avaliacoes[productId];
    const qrCode = produto.qrcodes?.codigo || `PROD-${String(productId).padStart(6, '0')}`;
    
    const body = `
        <div class="qty-product">
            <div class="icon">${produto.icone}</div>
            <h3>${produto.nome}</h3>
            <p>Estoque: ${produto.estoque} ${produto.unidade}</p>
        </div>
        
        <div class="qty-selector">
            <button class="qty-btn" onclick="changeQty(-1)">−</button>
            <div class="qty-value" id="qty-display">1</div>
            <button class="qty-btn" onclick="changeQty(1)">+</button>
        </div>
        
        <div class="action-buttons">
            <div class="action-btn" onclick="showQRCode('${qrCode}', '${produto.nome}')">
                <span class="icon">📱</span>
                <span>QR Code</span>
            </div>
        </div>
    `;
    
    const isAdmin = currentProfile?.role === 'admin';
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        ${isAdmin ? `<button class="btn btn-success" onclick="openEntradaModal(${productId})">Dar entrada</button>` : ''}
        <button class="btn btn-primary" onclick="confirmConsume()">Pegar ${selectedQty}</button>
    `;
    
    openModal('Pegar Produto', body, footer);
}

function changeQty(delta) {
    selectedQty = Math.max(1, Math.min(selectedProduct?.estoque || 99, selectedQty + delta));
    document.getElementById('qty-display').textContent = selectedQty;
    
    // Atualizar botão
    const footer = document.getElementById('modal-footer');
    const btn = footer.querySelector('.btn-primary');
    if (btn) btn.textContent = `Pegar ${selectedQty}`;
}

async function confirmConsume() {
    if (!selectedProduct) return;
    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }
    
    const prod = selectedProduct;
    const qtd = Number(selectedQty);
    
    try {
        const { data: novoEstoque, error } = await supabaseClient.rpc('registrar_movimentacao', {
            p_produto_id: Number(prod.id),
            p_user_id: userId,
            p_tipo: 'saida',
            p_quantidade: qtd,
            p_observacao: null
        });
        if (error) { console.error('Erro Supabase confirmConsume:', error); throw error; }
        
        showToast(`${qtd}x ${prod.nome} registrado!`, 'success');
        closeModal();
        
        const idx = cache.produtos.findIndex(p => p.id === prod.id);
        if (idx >= 0) {
            cache.produtos[idx].estoque = (typeof novoEstoque === 'number') ? novoEstoque : Math.max(0, prod.estoque - qtd);
        }
        
        renderPage();
    } catch (error) {
        console.error('Erro ao registrar consumo:', error);
        showToast('Erro ao registrar consumo: ' + (error.message || 'verifique o console'), 'error');
    }
}

// Garante o id do usuário logado. Se currentUser estiver vazio por algum
// motivo, busca direto do Supabase em vez de quebrar com "reading id of null".
async function getCurrentUserId() {
    if (currentUser?.id) return currentUser.id;
    try {
        const { data } = await supabaseClient.auth.getUser();
        if (data?.user) { currentUser = data.user; return data.user.id; }
    } catch (e) { console.error('Falha ao obter usuário:', e); }
    return null;
}

async function quickConsume(productId) {
    const produto = cache.produtos.find(p => p.id === productId);
    if (!produto || produto.estoque < 1) {
        showToast('Produto sem estoque!', 'error');
        return;
    }

    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }

    try {
        const { data: novoEstoque, error } = await supabaseClient.rpc('registrar_movimentacao', {
            p_produto_id: Number(productId),
            p_user_id: userId,
            p_tipo: 'saida',
            p_quantidade: 1,
            p_observacao: null
        });
        if (error) { console.error('Erro Supabase quickConsume:', error); throw error; }

        showToast(`1x ${produto.nome} ✓`, 'success');

        const idx = cache.produtos.findIndex(p => p.id === productId);
        if (idx >= 0) cache.produtos[idx].estoque = (typeof novoEstoque === 'number') ? novoEstoque : Math.max(0, produto.estoque - 1);

        renderPage();
    } catch (error) {
        console.error('Erro ao registrar:', error);
        showToast('Erro ao registrar: ' + (error.message || 'verifique o console'), 'error');
    }
}

// Modal de Entrada
function openEntradaModal(productId) {
    const produto = cache.produtos.find(p => p.id === productId);
    if (!produto) return;
    
    selectedProduct = produto;
    selectedQty = 1;
    
    const body = `
        <div class="qty-product">
            <div class="icon">${produto.icone}</div>
            <h3>${produto.nome}</h3>
            <p>Estoque atual: ${produto.estoque} ${produto.unidade}</p>
        </div>
        
        <div class="qty-selector">
            <button class="qty-btn" onclick="changeQtyEntrada(-10)">−10</button>
            <button class="qty-btn" onclick="changeQtyEntrada(-1)">−</button>
            <div class="qty-value" id="qty-display">1</div>
            <button class="qty-btn" onclick="changeQtyEntrada(1)">+</button>
            <button class="qty-btn" onclick="changeQtyEntrada(10)">+10</button>
        </div>
        
        <div class="form-group mt-4">
            <label>Observação (opcional)</label>
            <input type="text" id="entrada-obs" class="form-input" placeholder="Ex: Compra mensal">
        </div>
    `;
    
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-success" onclick="confirmEntrada()">Dar Entrada</button>
    `;
    
    openModal('Entrada de Estoque', body, footer);
}

function changeQtyEntrada(delta) {
    selectedQty = Math.max(1, selectedQty + delta);
    document.getElementById('qty-display').textContent = selectedQty;
}

async function confirmEntrada() {
    if (!selectedProduct) return;
    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }
    
    const obs = document.getElementById('entrada-obs')?.value || '';
    const prod = selectedProduct;
    const qtd = Number(selectedQty);
    
    try {
        const { data: novoEstoque, error } = await supabaseClient.rpc('registrar_movimentacao', {
            p_produto_id: Number(prod.id),
            p_user_id: userId,
            p_tipo: 'entrada',
            p_quantidade: qtd,
            p_observacao: obs || null
        });
        if (error) { console.error('Erro Supabase confirmEntrada:', error); throw error; }
        
        showToast(`+${qtd} ${prod.nome} adicionado!`, 'success');
        closeModal();
        
        const idx = cache.produtos.findIndex(p => p.id === prod.id);
        if (idx >= 0) {
            cache.produtos[idx].estoque = (typeof novoEstoque === 'number') ? novoEstoque : (prod.estoque + qtd);
        }
        
        renderPage();
    } catch (error) {
        console.error('Erro ao dar entrada:', error);
        showToast('Erro ao dar entrada: ' + (error.message || 'verifique o console'), 'error');
    }
}

// Modal de Sugestão
function openSugestaoModal() {
    const body = `
        <div class="form-group">
            <label>Nome do Produto *</label>
            <input type="text" id="sugestao-nome" class="form-input" placeholder="Ex: Café especial">
        </div>
        
        <div class="form-group">
            <label>Categoria</label>
            <select id="sugestao-categoria" class="form-input">
                <option value="">Selecione...</option>
                ${cache.categorias.map(c => `<option value="${c.id}">${c.icone} ${c.nome}</option>`).join('')}
            </select>
        </div>
        
        <div class="form-group">
            <label>Justificativa</label>
            <input type="text" id="sugestao-justificativa" class="form-input" placeholder="Por que você sugere este produto?">
        </div>
        
        <label style="display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer;">
            <input type="checkbox" id="sugestao-apoiar" checked style="width:18px; height:18px;">
            Já apoiar esta sugestão (👍)
        </label>
    `;
    
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="submitSugestao()">Enviar</button>
    `;
    
    openModal('Nova Sugestão', body, footer);
}

async function submitSugestao() {
    const nome = document.getElementById('sugestao-nome').value.trim();
    const categoriaVal = document.getElementById('sugestao-categoria').value;
    const justificativa = document.getElementById('sugestao-justificativa').value.trim();
    
    if (!nome) {
        showToast('Digite o nome do produto', 'error');
        return;
    }
    
    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }
    
    try {
        const apoiar = document.getElementById('sugestao-apoiar')?.checked;
        const { data: nova, error } = await supabaseClient
            .from('sugestoes')
            .insert({
                nome,
                categoria_id: categoriaVal ? Number(categoriaVal) : null,
                justificativa: justificativa || null,
                user_id: userId,
                status: 'pendente'
            })
            .select()
            .single();
        
        if (error) {
            console.error('Erro Supabase submitSugestao:', error);
            throw error;
        }

        // Voto de apoio opcional do próprio autor
        if (apoiar && nova) {
            await supabaseClient.from('votos_sugestao')
                .upsert({ sugestao_id: nova.id, user_id: userId, tipo: 'apoiar' }, { onConflict: 'sugestao_id,user_id' });
        }
        
        showToast('Sugestão enviada!', 'success');
        closeModal();
        
        if (currentPage === 'sugestoes') {
            await loadSugestoes();
            renderPage();
        }
    } catch (error) {
        console.error('Erro ao enviar sugestão:', error);
        showToast('Erro ao enviar sugestão: ' + (error.message || 'verifique o console'), 'error');
    }
}

// Modal de Alerta
function openAlertaModal() {
    const body = `
        <div class="form-group">
            <label>Produto (opcional)</label>
            <select id="alerta-produto" class="form-input">
                <option value="">Selecione ou deixe em branco</option>
                ${cache.produtos.map(p => `<option value="${p.id}">${p.icone} ${p.nome}</option>`).join('')}
            </select>
        </div>
        
        <div class="form-group">
            <label>Urgência</label>
            <select id="alerta-urgencia" class="form-input">
                <option value="baixo">🟢 Baixa</option>
                <option value="medio" selected>🟡 Média</option>
                <option value="alto">🔴 Alta</option>
            </select>
        </div>
        
        <div class="form-group">
            <label>Descrição *</label>
            <input type="text" id="alerta-descricao" class="form-input" placeholder="Descreva o problema...">
        </div>
    `;
    
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="submitAlerta()">Enviar Alerta</button>
    `;
    
    openModal('Novo Alerta', body, footer);
}

async function submitAlerta() {
    const produto = document.getElementById('alerta-produto').value;
    const urgencia = document.getElementById('alerta-urgencia').value;
    const descricao = document.getElementById('alerta-descricao').value.trim();
    
    if (!descricao) {
        showToast('Descreva o problema', 'error');
        return;
    }
    
    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }
    
    try {
        const { error } = await supabaseClient
            .from('alertas')
            .insert({
                produto_id: produto || null,
                urgencia,
                descricao,
                user_id: userId
            });
        
        if (error) throw error;
        
        showToast('Alerta enviado!', 'success');
        closeModal();
        
        await loadAlertas();
        updateBadges();
        
        if (currentPage === 'alertas') {
            renderPage();
        }
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao enviar alerta', 'error');
    }
}

// Modal de Fornecedor
function openFornecedorModal(fornecedorId = null) {
    const fornecedor = fornecedorId ? cache.fornecedores.find(f => f.id === fornecedorId) : null;
    
    const body = `
        <div class="form-group">
            <label>Nome *</label>
            <input type="text" id="fornecedor-nome" class="form-input" value="${fornecedor?.nome || ''}" placeholder="Nome do fornecedor">
        </div>
        
        <div class="form-group">
            <label>Contato</label>
            <input type="text" id="fornecedor-contato" class="form-input" value="${fornecedor?.contato || ''}" placeholder="Nome do contato">
        </div>
        
        <div class="form-group">
            <label>Telefone</label>
            <input type="text" id="fornecedor-telefone" class="form-input" value="${fornecedor?.telefone || ''}" placeholder="(00) 00000-0000">
        </div>
        
        <div class="form-group">
            <label>Email</label>
            <input type="email" id="fornecedor-email" class="form-input" value="${fornecedor?.email || ''}" placeholder="email@fornecedor.com">
        </div>
        
        <div class="form-group">
            <label>Observações</label>
            <input type="text" id="fornecedor-obs" class="form-input" value="${fornecedor?.observacoes || ''}" placeholder="Observações...">
        </div>
    `;
    
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        ${fornecedorId ? `<button class="btn btn-danger" onclick="deleteFornecedor(${fornecedorId})">Excluir</button>` : ''}
        <button class="btn btn-primary" onclick="saveFornecedor(${fornecedorId || 'null'})">${fornecedor ? 'Salvar' : 'Cadastrar'}</button>
    `;
    
    openModal(fornecedor ? 'Editar Fornecedor' : 'Novo Fornecedor', body, footer);
}

async function deleteFornecedor(id) {
    if (!confirm('Tem certeza que deseja excluir este fornecedor?')) return;
    try {
        const { error } = await supabaseClient.from('fornecedores').delete().eq('id', id);
        if (error) { console.error('Erro Supabase delete fornecedor:', error); throw error; }
        showToast('Fornecedor excluído!', 'success');
        closeModal();
        await loadFornecedores();
        renderPage();
    } catch (error) {
        console.error('Erro ao excluir fornecedor:', error);
        showToast('Erro ao excluir: ' + (error.message || 'verifique o console'), 'error');
    }
}

async function saveFornecedor(id) {
    const data = {
        nome: document.getElementById('fornecedor-nome').value.trim(),
        contato: document.getElementById('fornecedor-contato').value.trim() || null,
        telefone: document.getElementById('fornecedor-telefone').value.trim() || null,
        email: document.getElementById('fornecedor-email').value.trim() || null,
        observacoes: document.getElementById('fornecedor-obs').value.trim() || null,
        ativo: true
    };
    
    if (!data.nome) {
        showToast('Digite o nome do fornecedor', 'error');
        return;
    }
    
    try {
        if (id) {
            const { error } = await supabaseClient.from('fornecedores').update(data).eq('id', id);
            if (error) { console.error('Erro Supabase update fornecedor:', error); throw error; }
        } else {
            const { error } = await supabaseClient.from('fornecedores').insert(data);
            if (error) { console.error('Erro Supabase insert fornecedor:', error); throw error; }
        }
        
        showToast('Fornecedor salvo!', 'success');
        closeModal();
        await loadFornecedores();
        renderPage();
    } catch (error) {
        console.error('Erro ao salvar fornecedor:', error);
        showToast('Erro ao salvar: ' + (error.message || 'verifique o console'), 'error');
    }
}

// QR Code
function showQRCode(codigo, nome) {
    const body = `
        <div class="qr-container">
            <canvas id="qr-canvas"></canvas>
            <div class="qr-code-text">${codigo}</div>
        </div>
        <p class="text-center mt-4" style="color: var(--gray-500);">
            Escaneie para registrar consumo do produto<br><strong>${nome}</strong>
        </p>
    `;
    
    openModal('QR Code', body, `<button class="btn btn-primary" onclick="closeModal()">Fechar</button>`);
    
    // Gerar QR Code
    setTimeout(() => {
        const canvas = document.getElementById('qr-canvas');
        if (canvas && window.QRCode) {
            QRCode.toCanvas(canvas, codigo, { width: 200, margin: 2 });
        }
    }, 100);
}

// Avaliação
async function rateProduct(productId, tipo) {
    const userId = await getCurrentUserId();
    if (!userId) { showToast('Sua sessão expirou. Faça login novamente.', 'error'); return; }
    try {
        const current = cache.avaliacoes[productId];
        
        if (current === tipo) {
            // Clicou de novo na mesma avaliação → remove
            const { error } = await supabaseClient
                .from('avaliacoes')
                .delete()
                .eq('produto_id', productId)
                .eq('user_id', userId);
            if (error) { console.error('Erro Supabase rateProduct delete:', error); throw error; }
            delete cache.avaliacoes[productId];
        } else {
            const { error } = await supabaseClient
                .from('avaliacoes')
                .upsert({
                    produto_id: Number(productId),
                    user_id: userId,
                    tipo
                }, { onConflict: 'produto_id,user_id' });
            if (error) { console.error('Erro Supabase rateProduct upsert:', error); throw error; }
            cache.avaliacoes[productId] = tipo;
        }
        
        await loadProdutos();
        await loadAvaliacoes();
        renderPage();
    } catch (error) {
        console.error('Erro ao avaliar:', error);
        showToast('Erro ao avaliar: ' + (error.message || 'verifique o console'), 'error');
    }
}

// Logout
function confirmLogout() {
    const body = `
        <div class="text-center">
            <div style="font-size: 64px; margin-bottom: 16px;">👋</div>
            <p>Tem certeza que deseja sair?</p>
        </div>
    `;
    
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-danger" onclick="logout()">Sair</button>
    `;
    
    openModal('Sair', body, footer);
}

function showUserMenu() {
    const body = `
        <div class="list-item" style="cursor:pointer" onclick="closeModal(); openPerfilModal()">
            <div class="list-item-icon">⚙️</div>
            <div class="list-item-content">
                <div class="list-item-title">Meu Perfil</div>
                <div class="list-item-subtitle">Alterar nome e senha</div>
            </div>
        </div>
        <div class="list-item" style="cursor:pointer" onclick="closeModal(); confirmLogout()">
            <div class="list-item-icon">🚪</div>
            <div class="list-item-content">
                <div class="list-item-title">Sair</div>
            </div>
        </div>
    `;
    openModal('Conta', body, null);
}

// ----- Perfil do usuário -----
function openPerfilModal() {
    const body = `
        <div class="form-group">
            <label>Nome de usuário *</label>
            <input type="text" id="perfil-nome" class="form-input" value="${(currentProfile?.nome || '').replace(/"/g, '&quot;')}">
        </div>
        <div class="form-group">
            <label>E-mail de login</label>
            <input type="email" class="form-input" value="${currentUser?.email || ''}" disabled style="opacity:0.7;">
            <small style="color: var(--gray-500); display:block; margin-top:4px;">Para alterar o e-mail, fale com um administrador.</small>
        </div>
        <div style="border-top:1px solid var(--gray-200); margin-top:8px; padding-top:12px;">
            <p style="color: var(--gray-500); font-size: 14px; margin-bottom: 10px;">Alterar senha (opcional)</p>
            <div class="form-group">
                <label>Nova senha</label>
                <input type="password" id="perfil-senha" class="form-input" placeholder="Mínimo 6 caracteres">
            </div>
            <div class="form-group">
                <label>Confirmar nova senha</label>
                <input type="password" id="perfil-senha2" class="form-input" placeholder="Repita a nova senha">
            </div>
        </div>
    `;
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarPerfil()">Salvar</button>
    `;
    openModal('Meu Perfil', body, footer);
}

async function nomeEmUso(nome, exceptId) {
    try {
        const { data, error } = await supabaseClient.from('profiles').select('id').ilike('nome', nome);
        if (error) { console.warn('Erro ao checar nome:', error); return false; }
        return (data || []).some(p => p.id !== exceptId);
    } catch (e) { return false; }
}

async function salvarPerfil() {
    const nome = document.getElementById('perfil-nome').value.trim();
    const senha = document.getElementById('perfil-senha').value;
    const senha2 = document.getElementById('perfil-senha2').value;

    if (!nome) { showToast('Digite o nome de usuário', 'error'); return; }

    // Senha (se preenchida)
    if (senha || senha2) {
        if (senha.length < 6) { showToast('A nova senha deve ter no mínimo 6 caracteres', 'error'); return; }
        if (senha !== senha2) { showToast('As senhas não conferem', 'error'); return; }
    }

    try {
        // Nome único (ignora o próprio usuário)
        if (nome !== currentProfile?.nome && await nomeEmUso(nome, currentUser.id)) {
            showToast('Esse nome de usuário já está em uso', 'error');
            return;
        }

        // Atualiza nome no perfil
        const { error: errNome } = await supabaseClient
            .from('profiles')
            .update({ nome })
            .eq('id', currentUser.id);
        if (errNome) { console.error('Erro ao atualizar nome:', errNome); throw errNome; }
        currentProfile.nome = nome;

        // Atualiza senha, se informada
        if (senha) {
            const { error: errSenha } = await supabaseClient.auth.updateUser({ password: senha });
            if (errSenha) { console.error('Erro ao atualizar senha:', errSenha); throw errSenha; }
        }

        updateUserUI();
        showToast('Perfil atualizado!', 'success');
        closeModal();
    } catch (error) {
        console.error('Erro ao salvar perfil:', error);
        showToast('Erro ao salvar perfil: ' + (error.message || 'verifique o console'), 'error');
    }
}

// ============================================
// RELATÓRIOS E EXPORTAÇÕES
// ============================================
async function gerarRelatorioEstoque(formato) {
    if (formato === 'excel') {
        showToast('Gerando Excel...', 'success');
        const dados = cache.produtos.map(p => ({
            Produto: p.nome,
            Categoria: p.categorias?.nome || '-',
            Estoque: p.estoque,
            'Mínimo': p.estoque_minimo,
            Status: p.estoque <= p.estoque_minimo ? 'BAIXO' : 'OK'
        }));
        const ws = XLSX.utils.json_to_sheet(dados);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Estoque');
        XLSX.writeFile(wb, 'relatorio-estoque.xlsx');
        return;
    }

    showToast('Gerando PDF...', 'success');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text('Relatório de Estoque', 14, 22);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 30);
    
    const data = cache.produtos.map(p => [
        p.nome,
        p.categorias?.nome || '-',
        p.estoque,
        p.estoque_minimo,
        p.estoque <= p.estoque_minimo ? 'BAIXO' : 'OK'
    ]);
    
    doc.autoTable({
        startY: 40,
        head: [['Produto', 'Categoria', 'Estoque', 'Mínimo', 'Status']],
        body: data
    });
    
    doc.save('relatorio-estoque.pdf');
}

async function gerarRelatorioConsumo(formato) {
    showToast('Gerando relatório...', 'success');
    await loadMovimentacoes();

    if (formato === 'excel') {
        const dados = cache.movimentacoes.map(m => ({
            Produto: m.produtos?.nome || '-',
            Tipo: m.tipo === 'entrada' ? 'Entrada' : 'Saída',
            Quantidade: m.quantidade,
            'Usuário': m.profiles?.nome || '-',
            Data: new Date(m.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        }));
        const ws = XLSX.utils.json_to_sheet(dados);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Consumo');
        XLSX.writeFile(wb, 'relatorio-consumo.xlsx');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text('Relatório de Consumo', 14, 22);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 30);
    
    const data = cache.movimentacoes.slice(0, 50).map(m => [
        m.produtos?.nome || '-',
        m.tipo === 'entrada' ? 'Entrada' : 'Saída',
        m.quantidade,
        m.profiles?.nome || '-',
        new Date(m.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    ]);
    
    doc.autoTable({
        startY: 40,
        head: [['Produto', 'Tipo', 'Qtd', 'Usuário', 'Data']],
        body: data
    });
    
    doc.save('relatorio-consumo.pdf');
}

function gerarRelatorioCompras(formato) {
    if (formato === 'excel') exportComprasExcel();
    else exportComprasPDF();
}

function exportComprasPDF() {
    showToast('Gerando PDF...', 'success');
    const itens = itensCompraFiltradosOrdenados();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text('Lista de Compras', 14, 22);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 30);
    
    const data = itens.map(i => [
        i.nome,
        i.origens.map(o => COMPRA_TAGS[o].label).join(', '),
        i.estoque !== null ? i.estoque : '-',
        i.comprar,
        (i.justificativas[0] || '').slice(0, 40)
    ]);
    
    doc.autoTable({
        startY: 40,
        head: [['Produto', 'Origem', 'Estoque', 'Comprar', 'Observação']],
        body: data
    });
    
    doc.save('lista-compras.pdf');
}

function exportComprasExcel() {
    showToast('Gerando Excel...', 'success');
    const itens = itensCompraFiltradosOrdenados().map(i => ({
        Produto: i.nome,
        Origem: i.origens.map(o => COMPRA_TAGS[o].label).join(', '),
        'Estoque Atual': i.estoque !== null ? i.estoque : '',
        'Quantidade Comprar': i.comprar,
        Categoria: i.categoria || '',
        'Observação': i.justificativas.join(' | ')
    }));
    
    const ws = XLSX.utils.json_to_sheet(itens);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lista de Compras');
    XLSX.writeFile(wb, 'lista-compras.xlsx');
}

function exportarTudoExcel() {
    showToast('Exportando dados...', 'success');
    
    const wb = XLSX.utils.book_new();
    
    // Produtos
    const produtosData = cache.produtos.map(p => ({
        Nome: p.nome,
        Categoria: p.categorias?.nome || '-',
        Estoque: p.estoque,
        'Estoque Mínimo': p.estoque_minimo,
        Unidade: p.unidade,
        'Consumo Diário': p.consumo_diario,
        Likes: p.likes,
        Dislikes: p.dislikes
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(produtosData), 'Produtos');
    
    // Movimentações
    const movData = cache.movimentacoes.map(m => ({
        Produto: m.produtos?.nome || '-',
        Tipo: m.tipo,
        Quantidade: m.quantidade,
        Usuário: m.profiles?.nome || '-',
        Data: new Date(m.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(movData), 'Movimentações');
    
    XLSX.writeFile(wb, 'officesupplies-dados.xlsx');
}

function exportarTudoPDF() {
    showToast('Gerando PDF completo...', 'success');
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(24);
    doc.text('OfficeSupplies', 14, 22);
    doc.setFontSize(12);
    doc.text('Relatório Completo', 14, 32);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 40);
    
    // Estoque
    doc.setFontSize(16);
    doc.text('Estoque de Produtos', 14, 55);
    
    const prodData = cache.produtos.map(p => [
        p.nome,
        p.estoque,
        p.estoque_minimo,
        p.estoque <= p.estoque_minimo ? 'BAIXO' : 'OK'
    ]);
    
    doc.autoTable({
        startY: 60,
        head: [['Produto', 'Estoque', 'Mínimo', 'Status']],
        body: prodData
    });
    
    doc.save('officesupplies-completo.pdf');
}

// ============================================
// PUSH NOTIFICATIONS
// ============================================
async function setupPushNotifications() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        console.log('Push notifications não suportadas');
        return;
    }
    
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('Notificações permitidas');
        }
    } catch (error) {
        console.log('Erro ao configurar notificações:', error);
    }
}

function sendNotification(title, body) {
    if (Notification.permission === 'granted') {
        new Notification(title, {
            body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-72.png'
        });
    }
}

// ============================================
// UTILITÁRIOS
// ============================================
// Retorna a data no formato AAAA-MM-DD no fuso de Brasília (para filtros por dia)
function dataLocalISO(dateStr) {
    try {
        return new Date(dateStr).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    } catch (e) {
        return (dateStr || '').split('T')[0];
    }
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'agora';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
    
    return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ============================================
// SERVICE WORKER (PWA)
// ============================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('SW registrado'))
            .catch(err => console.log('SW erro:', err));
    });
   }

// ============================================
// CADASTRO DE PRODUTOS (ADMIN)
// ============================================
// ============================================
// GESTÃO DE CATEGORIAS
// ============================================
// ============================================
// CONFIGURAÇÕES (admin) — consumo médio
// ============================================
let consumoFiltroModo = 'todos';
let consumoSelecao = new Set();

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function produtosConsumoFiltrados() {
    let produtos = [...cache.produtos];
    if (consumoFiltroModo === 'automatico') produtos = produtos.filter(p => (p.consumo_modo || 'automatico') !== 'manual');
    if (consumoFiltroModo === 'manual') produtos = produtos.filter(p => p.consumo_modo === 'manual');
    produtos.sort((a, b) => a.nome.localeCompare(b.nome));
    return produtos;
}

function renderConsumoLinhaProduto(p) {
    const manual = p.consumo_modo === 'manual';
    const efetivo = consumoEfetivo(p);
    const sel = consumoSelecao.has(p.id);
    return `
        <div class="list-item" style="cursor:default;">
            <input type="checkbox" class="consumo-check" data-id="${p.id}" ${sel ? 'checked' : ''} onchange="toggleConsumoSel(${p.id})" style="width:18px; height:18px; margin-right:8px;">
            <div class="list-item-content">
                <div class="list-item-title">${p.icone || '📦'} ${p.nome}</div>
                <div class="list-item-subtitle">
                    Consumo: ${efetivo.toFixed(2)}/dia
                    <span class="badge ${manual ? 'badge-warning' : 'badge-info'}" style="margin-left:6px;">${manual ? '✏️ manual' : 'automático'}</span>
                </div>
            </div>
            <div class="list-item-right" style="display:flex; gap:6px; align-items:center;">
                <input type="number" id="consumo-ind-${p.id}" value="${manual ? (p.consumo_diario || 0) : efetivo.toFixed(2)}" min="0" step="0.1" style="width:70px; text-align:center; padding:6px; border:1px solid var(--gray-300,#ccc); border-radius:8px;">
                <button class="btn btn-secondary btn-sm" style="padding:6px 8px;" title="Definir manual" onclick="salvarConsumoIndividual(${p.id})">✓</button>
            </div>
        </div>`;
}

function renderConsumoLista() {
    const produtos = produtosConsumoFiltrados();
    if (produtos.length === 0) return '<div class="empty-state"><p>Nenhum produto.</p></div>';
    return produtos.map(renderConsumoLinhaProduto).join('');
}

function atualizarContadorConsumo() {
    const el = document.getElementById('consumo-contador');
    if (el) el.textContent = `${consumoSelecao.size} selecionado(s)`;
}

function renderConfiguracoes() {
    if (currentProfile?.role !== 'admin') {
        return `<div class="empty-state"><div class="icon">🔒</div><h3>Acesso Restrito</h3><p>Apenas administradores.</p></div>`;
    }

    const cfg = cache.config || { periodo: 30, diasSemana: [0, 1, 2, 3, 4, 5, 6] };

    return `
        <div class="page-header">
            <div class="page-title">Configurações</div>
            <div class="page-subtitle">Ajustes do sistema</div>
        </div>

        <div class="card">
            <div class="card-title">📊 Cálculo do consumo médio</div>
            <div class="form-group">
                <label>Período da média (dias)</label>
                <input type="number" id="cfg-periodo" class="form-input" value="${cfg.periodo}" min="1">
                <small style="color: var(--gray-500);">Sobre quantos dias calcular o consumo (ex: 30).</small>
            </div>
            <div class="form-group">
                <label>Dias considerados no cálculo</label>
                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                    ${DIAS_SEMANA.map((d, i) => `
                        <label style="display:flex; align-items:center; gap:4px; font-size:14px;">
                            <input type="checkbox" id="cfg-dia-${i}" ${cfg.diasSemana.includes(i) ? 'checked' : ''}> ${d}
                        </label>`).join('')}
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="btn btn-secondary btn-sm" onclick="marcarDias('semana')">Dias de semana</button>
                    <button class="btn btn-secondary btn-sm" onclick="marcarDias('fim')">Fins de semana</button>
                    <button class="btn btn-secondary btn-sm" onclick="marcarDias('todos')">Todos</button>
                </div>
            </div>
            <button class="btn btn-primary mt-4" onclick="salvarConfig()">Salvar configurações</button>
        </div>

        <div class="card">
            <div class="card-title">💡 Sugestões</div>
            <div class="form-group">
                <label>Alertar sugestões paradas há mais de (dias)</label>
                <input type="number" id="cfg-sug-alerta" class="form-input" value="${cfg.sugestaoAlertaDias != null ? cfg.sugestaoAlertaDias : 15}" min="1">
                <small style="color: var(--gray-500);">Sugestões pendentes com mais dias que isso ganham destaque de "parada" (só o admin vê).</small>
            </div>
            <button class="btn btn-primary" onclick="salvarConfig()">Salvar</button>
        </div>

        <div class="card">
            <div class="card-title">📦 Consumo dos produtos</div>

            <div class="config-grid" style="margin-bottom:12px;">
                <div class="config-item">
                    <label>Filtrar por modo</label>
                    <select class="form-input" onchange="setFiltroConsumoModo(this.value)">
                        <option value="todos" ${consumoFiltroModo === 'todos' ? 'selected' : ''}>Todos</option>
                        <option value="automatico" ${consumoFiltroModo === 'automatico' ? 'selected' : ''}>Automáticos</option>
                        <option value="manual" ${consumoFiltroModo === 'manual' ? 'selected' : ''}>Manuais</option>
                    </select>
                </div>
            </div>

            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid var(--gray-200,#eee);">
                <button class="btn btn-secondary btn-sm" onclick="toggleConsumoSelTodos()">Selecionar todos</button>
                <span id="consumo-contador" style="color:var(--gray-500); font-size:13px;">${consumoSelecao.size} selecionado(s)</span>
                <div style="flex:1;"></div>
                <input type="number" id="consumo-massa-valor" placeholder="valor" min="0" step="0.1" style="width:80px; text-align:center; padding:6px; border:1px solid var(--gray-300,#ccc); border-radius:8px;">
                <button class="btn btn-primary btn-sm" onclick="aplicarManualEmMassa()">Aplicar manual</button>
                <button class="btn btn-secondary btn-sm" onclick="voltarAutomaticoSelecionados()">Voltar p/ automático</button>
            </div>

            <div id="consumo-lista">${renderConsumoLista()}</div>
        </div>
    `;
}

function marcarDias(tipo) {
    const set = (i, v) => { const el = document.getElementById('cfg-dia-' + i); if (el) el.checked = v; };
    if (tipo === 'semana') { [0, 6].forEach(i => set(i, false)); [1, 2, 3, 4, 5].forEach(i => set(i, true)); }
    else if (tipo === 'fim') { [1, 2, 3, 4, 5].forEach(i => set(i, false)); [0, 6].forEach(i => set(i, true)); }
    else { [0, 1, 2, 3, 4, 5, 6].forEach(i => set(i, true)); }
}

async function salvarConfig() {
    const periodo = Math.max(1, parseInt(document.getElementById('cfg-periodo').value) || 30);
    const dias = [];
    for (let i = 0; i < 7; i++) { if (document.getElementById('cfg-dia-' + i)?.checked) dias.push(i); }
    if (dias.length === 0) { showToast('Selecione ao menos um dia', 'error'); return; }
    const sugAlerta = Math.max(1, parseInt(document.getElementById('cfg-sug-alerta')?.value) || 15);
    try {
        const { error } = await supabaseClient.from('configuracoes').update({
            consumo_periodo_dias: periodo,
            consumo_dias_semana: dias.join(','),
            sugestao_alerta_dias: sugAlerta,
            updated_at: new Date().toISOString()
        }).eq('id', 1);
        if (error) throw error;
        await loadConfig();
        showToast('Configurações salvas!', 'success');
    } catch (error) {
        console.error('Erro ao salvar config:', error);
        showToast('Erro ao salvar: ' + (error.message || ''), 'error');
    }
}

function setFiltroConsumoModo(v) {
    consumoFiltroModo = v;
    const lista = document.getElementById('consumo-lista');
    if (lista) lista.innerHTML = renderConsumoLista();
}

function toggleConsumoSel(id) {
    if (consumoSelecao.has(id)) consumoSelecao.delete(id); else consumoSelecao.add(id);
    atualizarContadorConsumo();
}

function toggleConsumoSelTodos() {
    const produtos = produtosConsumoFiltrados();
    const todosSelecionados = produtos.length > 0 && produtos.every(p => consumoSelecao.has(p.id));
    if (todosSelecionados) produtos.forEach(p => consumoSelecao.delete(p.id));
    else produtos.forEach(p => consumoSelecao.add(p.id));
    // Atualiza os checkboxes visíveis sem recarregar a tela
    document.querySelectorAll('.consumo-check').forEach(chk => {
        chk.checked = consumoSelecao.has(parseInt(chk.dataset.id));
    });
    atualizarContadorConsumo();
}

async function aplicarManualEmMassa() {
    const valor = parseFloat(document.getElementById('consumo-massa-valor').value);
    if (isNaN(valor) || valor < 0) { showToast('Informe um valor válido', 'error'); return; }
    if (consumoSelecao.size === 0) { showToast('Selecione ao menos um produto', 'error'); return; }
    try {
        const ids = Array.from(consumoSelecao);
        const { error } = await supabaseClient.from('produtos')
            .update({ consumo_modo: 'manual', consumo_diario: valor })
            .in('id', ids);
        if (error) throw error;
        showToast(`${ids.length} produto(s) definido(s) como manual`, 'success');
        await loadProdutos();
        consumoSelecao.clear();
        atualizarContadorConsumo();
        const lista = document.getElementById('consumo-lista');
        if (lista) lista.innerHTML = renderConsumoLista();
    } catch (error) {
        console.error('Erro ao aplicar manual em massa:', error);
        showToast('Erro: ' + (error.message || ''), 'error');
    }
}

async function voltarAutomaticoSelecionados() {
    if (consumoSelecao.size === 0) { showToast('Selecione ao menos um produto', 'error'); return; }
    try {
        const ids = Array.from(consumoSelecao);
        const { error } = await supabaseClient.from('produtos')
            .update({ consumo_modo: 'automatico' })
            .in('id', ids);
        if (error) throw error;
        showToast(`${ids.length} produto(s) voltaram para automático`, 'success');
        await loadProdutos();
        await calcularConsumos();
        consumoSelecao.clear();
        atualizarContadorConsumo();
        const lista = document.getElementById('consumo-lista');
        if (lista) lista.innerHTML = renderConsumoLista();
    } catch (error) {
        console.error('Erro ao voltar automático:', error);
        showToast('Erro: ' + (error.message || ''), 'error');
    }
}

async function salvarConsumoIndividual(id) {
    const valor = parseFloat(document.getElementById('consumo-ind-' + id).value);
    if (isNaN(valor) || valor < 0) { showToast('Valor inválido', 'error'); return; }
    try {
        const { error } = await supabaseClient.from('produtos')
            .update({ consumo_modo: 'manual', consumo_diario: valor })
            .eq('id', id);
        if (error) throw error;
        showToast('Consumo manual definido', 'success');
        await loadProdutos();
        const lista = document.getElementById('consumo-lista');
        if (lista) lista.innerHTML = renderConsumoLista();
    } catch (error) {
        console.error('Erro ao salvar consumo individual:', error);
        showToast('Erro: ' + (error.message || ''), 'error');
    }
}

function renderCategorias() {
    if (currentProfile?.role !== 'admin') {
        return `<div class="empty-state"><div class="icon">🔒</div><h3>Acesso Restrito</h3><p>Apenas administradores.</p></div>`;
    }

    const contar = (catId) => cache.produtos.filter(p => p.categoria_id === catId).length;

    return `
        <div class="page-header">
            <div class="page-title">Categorias</div>
            <div class="page-subtitle">Organize os produtos por categoria</div>
        </div>

        <div class="card">
            <div class="card-title">🏷️ Nova Categoria</div>
            <div style="display:grid; grid-template-columns: 80px 1fr; gap:12px; align-items:end;">
                <div class="form-group" style="margin:0;">
                    <label>Ícone</label>
                    <input type="text" id="cat-icone" class="form-input" value="📦" maxlength="2" style="text-align:center;">
                </div>
                <div class="form-group" style="margin:0;">
                    <label>Nome *</label>
                    <input type="text" id="cat-nome" class="form-input" placeholder="Ex: Limpeza">
                </div>
            </div>
            <button class="btn btn-primary mt-4" onclick="salvarCategoria()">➕ Adicionar Categoria</button>
        </div>

        <div class="card">
            <div class="card-title">📋 Categorias (${cache.categorias.length})</div>
            ${cache.categorias.length === 0 ? `
                <div class="empty-state"><div class="icon">🏷️</div><p>Nenhuma categoria cadastrada</p></div>
            ` : cache.categorias.map(c => {
                const qtd = contar(c.id);
                return `
                    <div class="list-item" style="cursor:default;">
                        <div class="list-item-icon">${c.icone || '📦'}</div>
                        <div class="list-item-content">
                            <div class="list-item-title">${c.nome}</div>
                            <div class="list-item-subtitle">${qtd} ${qtd === 1 ? 'produto' : 'produtos'}</div>
                        </div>
                        <div class="list-item-right" style="display:flex; gap:6px;">
                            <button class="btn btn-secondary btn-sm" onclick="editarCategoria(${c.id})" style="padding:6px 10px;">✏️</button>
                            <button class="btn btn-danger btn-sm" onclick="excluirCategoria(${c.id})" style="padding:6px 10px;">🗑️</button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

async function salvarCategoria() {
    const nome = document.getElementById('cat-nome').value.trim();
    const icone = document.getElementById('cat-icone').value.trim() || '📦';
    if (!nome) { showToast('Digite o nome da categoria', 'error'); return; }

    // Evitar duplicada (nome é único no banco)
    if (cache.categorias.some(c => c.nome.toLowerCase() === nome.toLowerCase())) {
        showToast('Já existe uma categoria com esse nome', 'error');
        return;
    }

    try {
        const { error } = await supabaseClient.from('categorias').insert({ nome, icone, ativo: true });
        if (error) { console.error('Erro Supabase salvarCategoria:', error); throw error; }
        showToast('Categoria adicionada!', 'success');
        await loadCategorias();
        renderPage();
    } catch (error) {
        console.error('Erro ao salvar categoria:', error);
        const msg = String(error.message || '');
        showToast(msg.includes('duplicate') ? 'Já existe uma categoria com esse nome' : 'Erro ao salvar: ' + msg, 'error');
    }
}

function abrirNovaCategoriaRapida() {
    const body = `
        <div style="display:grid; grid-template-columns:80px 1fr; gap:12px; align-items:end;">
            <div class="form-group" style="margin:0;">
                <label>Ícone</label>
                <input type="text" id="quick-cat-icone" class="form-input" value="📦" maxlength="2" style="text-align:center;">
            </div>
            <div class="form-group" style="margin:0;">
                <label>Nome *</label>
                <input type="text" id="quick-cat-nome" class="form-input" placeholder="Ex: Limpeza">
            </div>
        </div>
    `;
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarCategoriaRapida()">Criar e selecionar</button>
    `;
    openModal('Nova categoria', body, footer);
}

async function salvarCategoriaRapida() {
    const nome = document.getElementById('quick-cat-nome').value.trim();
    const icone = document.getElementById('quick-cat-icone').value.trim() || '📦';
    if (!nome) { showToast('Digite o nome da categoria', 'error'); return; }
    if (cache.categorias.some(c => c.nome.toLowerCase() === nome.toLowerCase())) {
        showToast('Já existe uma categoria com esse nome', 'error');
        return;
    }
    try {
        const { data, error } = await supabaseClient
            .from('categorias')
            .insert({ nome, icone, ativo: true })
            .select()
            .single();
        if (error) { console.error('Erro Supabase salvarCategoriaRapida:', error); throw error; }

        await loadCategorias();
        closeModal();

        // Acrescenta a opção ao select e já seleciona, sem recarregar a tela
        // (preserva o que o usuário já preencheu no formulário do produto)
        const sel = document.getElementById('prod-categoria');
        if (sel) {
            const opt = document.createElement('option');
            opt.value = data.id;
            opt.textContent = `${icone} ${nome}`;
            sel.appendChild(opt);
            sel.value = data.id;
        }
        showToast('Categoria criada e selecionada!', 'success');
    } catch (error) {
        console.error('Erro ao criar categoria rápida:', error);
        showToast('Erro ao criar categoria: ' + (error.message || ''), 'error');
    }
}

function editarCategoria(catId) {
    const cat = cache.categorias.find(c => c.id === catId);
    if (!cat) return;
    const body = `
        <div style="display:grid; grid-template-columns: 80px 1fr; gap:12px; align-items:end;">
            <div class="form-group" style="margin:0;">
                <label>Ícone</label>
                <input type="text" id="edit-cat-icone" class="form-input" value="${cat.icone || '📦'}" maxlength="2" style="text-align:center;">
            </div>
            <div class="form-group" style="margin:0;">
                <label>Nome *</label>
                <input type="text" id="edit-cat-nome" class="form-input" value="${(cat.nome || '').replace(/"/g, '&quot;')}">
            </div>
        </div>
    `;
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="atualizarCategoria(${catId})">Salvar</button>
    `;
    openModal('Editar Categoria', body, footer);
}

async function atualizarCategoria(catId) {
    const nome = document.getElementById('edit-cat-nome').value.trim();
    const icone = document.getElementById('edit-cat-icone').value.trim() || '📦';
    if (!nome) { showToast('Digite o nome da categoria', 'error'); return; }

    if (cache.categorias.some(c => c.id !== catId && c.nome.toLowerCase() === nome.toLowerCase())) {
        showToast('Já existe outra categoria com esse nome', 'error');
        return;
    }

    try {
        const { error } = await supabaseClient.from('categorias').update({ nome, icone }).eq('id', catId);
        if (error) { console.error('Erro Supabase atualizarCategoria:', error); throw error; }
        showToast('Categoria atualizada!', 'success');
        closeModal();
        await loadCategorias();
        await loadProdutos();
        renderPage();
    } catch (error) {
        console.error('Erro ao atualizar categoria:', error);
        showToast('Erro ao atualizar: ' + (error.message || ''), 'error');
    }
}

function excluirCategoria(catId) {
    const cat = cache.categorias.find(c => c.id === catId);
    if (!cat) return;
    const produtos = cache.produtos.filter(p => p.categoria_id === catId);

    // Sem produtos → confirmação simples
    if (produtos.length === 0) {
        const body = `<p>Excluir a categoria <strong>${cat.nome}</strong>?</p>`;
        const footer = `
            <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
            <button class="btn btn-danger" onclick="confirmarExclusaoCategoria(${catId})">Excluir</button>
        `;
        openModal('Excluir Categoria', body, footer);
        return;
    }

    // Com produtos → 3 opções
    const body = `
        <p>A categoria <strong>${cat.nome}</strong> tem <strong>${produtos.length} ${produtos.length === 1 ? 'produto' : 'produtos'}</strong> vinculado(s).</p>
        <p style="color: var(--gray-600); margin-top:8px;">O que deseja fazer?</p>
    `;
    const footer = `
        <div style="display:flex; flex-direction:column; gap:8px; width:100%;">
            <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
            <button class="btn btn-warning" onclick="abrirMoverProdutosCategoria(${catId})">Editar a categoria dos produtos antes</button>
            <button class="btn btn-danger" onclick="confirmarExclusaoCategoria(${catId})">Excluir e deixar produtos sem categoria</button>
        </div>
    `;
    openModal('Excluir Categoria', body, footer);
}

function abrirMoverProdutosCategoria(catId) {
    const cat = cache.categorias.find(c => c.id === catId);
    const produtos = cache.produtos.filter(p => p.categoria_id === catId);
    const outras = cache.categorias.filter(c => c.id !== catId);

    if (outras.length === 0) {
        showToast('Não há outra categoria para mover os produtos. Crie uma antes.', 'error');
        return;
    }

    const body = `
        <p>Mover os <strong>${produtos.length}</strong> produto(s) de <strong>${cat.nome}</strong> para:</p>
        <div class="form-group" style="margin-top:12px;">
            <label>Categoria destino</label>
            <select id="cat-destino" class="form-input">
                ${outras.map(c => `<option value="${c.id}">${c.icone || '📦'} ${c.nome}</option>`).join('')}
            </select>
        </div>
        <p style="color: var(--gray-500); font-size:13px;">Depois de mover, a categoria <strong>${cat.nome}</strong> será excluída.</p>
    `;
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="moverProdutosEExcluir(${catId})">Mover e excluir</button>
    `;
    openModal('Mover produtos', body, footer);
}

async function moverProdutosEExcluir(catId) {
    const destino = parseInt(document.getElementById('cat-destino').value);
    if (!destino) { showToast('Selecione a categoria destino', 'error'); return; }
    try {
        const { error: errMove } = await supabaseClient.from('produtos')
            .update({ categoria_id: destino })
            .eq('categoria_id', catId);
        if (errMove) { console.error('Erro ao mover produtos:', errMove); throw errMove; }

        const { error: errDel } = await supabaseClient.from('categorias').delete().eq('id', catId);
        if (errDel) { console.error('Erro ao excluir categoria:', errDel); throw errDel; }

        showToast('Produtos movidos e categoria excluída!', 'success');
        closeModal();
        await loadCategorias();
        await loadProdutos();
        renderPage();
    } catch (error) {
        console.error('Erro ao mover/excluir:', error);
        showToast('Erro: ' + (error.message || 'verifique o console'), 'error');
    }
}

async function confirmarExclusaoCategoria(catId) {
    try {
        const { error } = await supabaseClient.from('categorias').delete().eq('id', catId);
        if (error) { console.error('Erro Supabase excluirCategoria:', error); throw error; }
        showToast('Categoria excluída', 'success');
        closeModal();
        await loadCategorias();
        await loadProdutos();
        renderPage();
    } catch (error) {
        console.error('Erro ao excluir categoria:', error);
        showToast('Erro ao excluir: ' + (error.message || 'verifique o console'), 'error');
    }
}

function renderCadastroProduto() {
    if (currentProfile?.role !== 'admin') {
        return `
            <div class="empty-state">
                <div class="icon">🔒</div>
                <h3>Acesso Restrito</h3>
                <p>Apenas administradores podem cadastrar produtos.</p>
            </div>
        `;
    }
    
    return `
        <div class="page-header">
            <div class="page-title">Cadastrar Produto</div>
            <div class="page-subtitle">Adicione novos produtos ao estoque</div>
        </div>
        
        <div class="card">
            <div class="card-title">📦 Novo Produto</div>
            
            <div class="form-group">
                <label>Nome do Produto *</label>
                <input type="text" id="prod-nome" class="form-input" placeholder="Ex: Caneta Azul">
            </div>
            
            <div class="form-group">
                <label>Código interno</label>
                <input type="text" id="prod-codigo" class="form-input" placeholder="Ex: CAN-001 (opcional)">
            </div>
            
            <div class="form-group">
                <label>Código de barras (EAN)</label>
                <input type="text" id="prod-ean" class="form-input" placeholder="Ex: 7891234567890 (opcional)">
            </div>
            
            <div class="form-group">
                <label>Unidades por embalagem de compra</label>
                <input type="number" id="prod-fator" class="form-input" value="1" min="1">
                <small style="color: var(--gray-500); display:block; margin-top:4px;">Ex: compra em caixa com 10 unidades → 10. Padrão 1.</small>
            </div>
            
            <div class="form-group">
                <label>Ícone (emoji)</label>
                <input type="text" id="prod-icone" class="form-input" placeholder="📦" value="📦" maxlength="2">
            </div>
            
            <div class="form-group">
                <label>Categoria *</label>
                <div style="display:flex; gap:8px; align-items:stretch;">
                    <select id="prod-categoria" class="form-input" style="flex:1 1 auto; min-width:0;">
                        <option value="">Selecione...</option>
                        ${cache.categorias.map(c => `<option value="${c.id}">${c.icone} ${c.nome}</option>`).join('')}
                    </select>
                    <button type="button" class="btn btn-secondary" onclick="abrirNovaCategoriaRapida()" title="Nova categoria" style="flex:0 0 48px; width:48px; padding:0; font-size:22px; line-height:1;">+</button>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                    <label>Estoque Inicial *</label>
                    <input type="number" id="prod-estoque" class="form-input" placeholder="0" min="0" value="0">
                </div>
                
                <div class="form-group">
                    <label>Estoque Mínimo *</label>
                    <input type="number" id="prod-minimo" class="form-input" placeholder="10" min="1" value="10">
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                    <label>Unidade</label>
                    <select id="prod-unidade" class="form-input">
                        <option value="un">Unidade (un)</option>
                        <option value="cx">Caixa (cx)</option>
                        <option value="pct">Pacote (pct)</option>
                        <option value="kg">Quilograma (kg)</option>
                        <option value="lt">Litro (lt)</option>
                        <option value="mt">Metro (mt)</option>
                        <option value="rl">Rolo (rl)</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Consumo diário</label>
                    <select id="prod-consumo-modo" class="form-input" onchange="document.getElementById('prod-consumo').disabled = (this.value !== 'manual')">
                        <option value="automatico">Automático (calculado pelo histórico)</option>
                        <option value="manual">Manual (valor fixo)</option>
                    </select>
                    <input type="number" id="prod-consumo" class="form-input" placeholder="valor manual" min="0" step="0.1" value="0" style="margin-top:8px;" disabled>
                    <small style="color: var(--gray-500); display:block; margin-top:4px;">No automático, o consumo é calculado pelas saídas. Produto novo começa em 0.</small>
                </div>
            </div>
            
            <button class="btn btn-primary" onclick="salvarProduto()">
                ➕ Cadastrar Produto
            </button>
        </div>
        
        <div class="card">
            <div class="card-title">📥 Importar catálogo (Excel/CSV)</div>
            <p style="color: var(--gray-500); font-size: 14px; margin-bottom: 12px;">
                Cadastre ou atualize vários produtos de uma vez. O sistema casa pelo <strong>código</strong> (ou pelo nome, se não houver código). Produtos novos são criados; existentes têm os dados atualizados — <strong>o estoque de quem já existe não é alterado</strong> por aqui.
            </p>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" onclick="baixarModeloImportacao()">⬇️ Baixar modelo</button>
                <button class="btn btn-primary btn-sm" onclick="document.getElementById('arquivo-import').click()">📂 Escolher arquivo</button>
            </div>
            <input type="file" id="arquivo-import" accept=".xlsx,.xls,.csv" style="display:none" onchange="lerArquivoImportacao(event)">
        </div>
        
        <div class="card">
            <div class="card-title">📥 Importar nota (XML da NF-e)</div>
            <p style="color: var(--gray-500); font-size: 14px; margin-bottom: 12px;">
                Dá entrada no estoque a partir do XML da nota. Itens reconhecidos (por código de barras ou vínculo já aprendido) entram automaticamente; os não reconhecidos podem ser vinculados a um produto seu na hora.
            </p>
            <button class="btn btn-primary btn-sm" onclick="dispararImportNota()">📂 Escolher XML</button>
            <input type="file" id="arquivo-nota" accept=".xml" style="display:none" onchange="lerNotaXML(event)">
        </div>
        
        <div class="card">
            <div class="card-title">📋 Produtos Cadastrados</div>
            <p style="color: var(--gray-500); margin-bottom: 12px;">
                ${cache.produtos.length} produtos no sistema
            </p>
            
            <div class="search-bar" style="margin-bottom: 12px;">
                <div class="search-input">
                    <span class="search-icon">🔍</span>
                    <input 
                        type="text" 
                        placeholder="Buscar produto..." 
                        oninput="filterCadastroProdutos(this.value)"
                        id="search-cadastro"
                    >
                </div>
            </div>
            
            <div id="cadastro-produtos-list">
                ${cache.produtos.map(p => `
                    <div class="list-item" onclick="openEditProdutoModal(${p.id})">
                        <div class="list-item-icon">${p.icone}</div>
                        <div class="list-item-content">
                            <div class="list-item-title">${p.nome}</div>
                            <div class="list-item-subtitle">${p.categorias?.nome || 'Sem categoria'} • ${p.estoque} ${p.unidade}</div>
                        </div>
                        <div class="list-item-right">
                            <button class="btn btn-secondary btn-sm">✏️ Editar</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function filterCadastroProdutos(query) {
    const q = query.toLowerCase();
    const filtered = cache.produtos.filter(p => p.nome.toLowerCase().includes(q));
    document.getElementById('cadastro-produtos-list').innerHTML = filtered.map(p => `
        <div class="list-item" onclick="openEditProdutoModal(${p.id})">
            <div class="list-item-icon">${p.icone}</div>
            <div class="list-item-content">
                <div class="list-item-title">${p.nome}</div>
                <div class="list-item-subtitle">${p.categorias?.nome || 'Sem categoria'} • ${p.estoque} ${p.unidade}</div>
            </div>
            <div class="list-item-right">
                <button class="btn btn-secondary btn-sm">✏️ Editar</button>
            </div>
        </div>
    `).join('') || '<p style="color:var(--gray-500);padding:12px;">Nenhum produto encontrado.</p>';
}

// ============================================
// IMPORTAÇÃO DE CATÁLOGO (Excel / CSV)
// ============================================
let importPreview = null;

function baixarModeloImportacao() {
    const modelo = [{
        codigo: 'CAN-001',
        nome: 'Caneta Azul',
        categoria: 'Escritório',
        estoque: 50,
        estoque_minimo: 10,
        unidade: 'un',
        consumo_diario: 1
    }];
    const ws = XLSX.utils.json_to_sheet(modelo);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
    XLSX.writeFile(wb, 'modelo-importacao-produtos.xlsx');
}

function lerArquivoImportacao(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const linhas = XLSX.utils.sheet_to_json(ws, { defval: '' });
            processarPreviaImportacao(linhas);
        } catch (err) {
            console.error('Erro ao ler arquivo:', err);
            showToast('Não foi possível ler o arquivo. Verifique se é um Excel ou CSV válido.', 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

function processarPreviaImportacao(linhas) {
    if (!linhas || linhas.length === 0) {
        showToast('A planilha está vazia.', 'error');
        return;
    }
    const novos = [], atualizacoes = [], erros = [];
    linhas.forEach((row, i) => {
        const get = (k) => {
            const key = Object.keys(row).find(rk => rk.toLowerCase().trim() === k);
            return key !== undefined ? String(row[key]).trim() : '';
        };
        const nome = get('nome');
        if (!nome) { erros.push({ linha: i + 2, motivo: 'Sem nome' }); return; }
        const codigo = get('codigo') || null;
        const categoria = get('categoria') || null;
        const item = {
            codigo, nome, categoria,
            estoque: parseInt(get('estoque')) || 0,
            minimo: parseInt(get('estoque_minimo')) || 10,
            unidade: get('unidade') || 'un',
            consumo: parseFloat(String(get('consumo_diario')).replace(',', '.')) || 1,
            existenteId: null
        };
        let existente = null;
        if (codigo) existente = cache.produtos.find(p => (p.codigo || '').toLowerCase() === codigo.toLowerCase());
        if (!existente) existente = cache.produtos.find(p => p.nome.toLowerCase() === nome.toLowerCase());
        if (existente) { item.existenteId = existente.id; atualizacoes.push(item); }
        else novos.push(item);
    });

    importPreview = { novos, atualizacoes, erros };
    mostrarPreviaImportacao();
}

function mostrarPreviaImportacao() {
    const { novos, atualizacoes, erros } = importPreview;
    const linha = (i, tipo) => `
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--gray-100,#eee); font-size:13px;">
            <span>${i.nome} ${i.codigo ? `<span style="color:var(--gray-500)">(${i.codigo})</span>` : ''}</span>
            <span style="color:var(--gray-500)">${tipo === 'novo' ? 'estoque ' + i.estoque : 'sem mexer no estoque'}</span>
        </div>`;
    const bloco = (titulo, arr, tipo, cor) => arr.length ? `
        <div style="margin-bottom:14px;">
            <div style="font-weight:600; color:${cor}; margin-bottom:6px;">${titulo} (${arr.length})</div>
            ${arr.slice(0, 50).map(i => linha(i, tipo)).join('')}
            ${arr.length > 50 ? `<div style="color:var(--gray-500); font-size:12px; margin-top:4px;">+ ${arr.length - 50} outros…</div>` : ''}
        </div>` : '';

    const body = `
        <p style="color: var(--gray-600); margin-bottom: 14px;">Revise antes de confirmar:</p>
        ${bloco('🆕 Novos produtos', novos, 'novo', 'var(--success)')}
        ${bloco('♻️ Atualizações', atualizacoes, 'upd', 'var(--primary, #2563eb)')}
        ${erros.length ? `
            <div style="margin-bottom:14px;">
                <div style="font-weight:600; color:var(--danger); margin-bottom:6px;">⚠️ Ignorados (${erros.length})</div>
                ${erros.slice(0, 20).map(e => `<div style="font-size:13px; color:var(--gray-500);">Linha ${e.linha}: ${e.motivo}</div>`).join('')}
            </div>` : ''}
        ${(novos.length === 0 && atualizacoes.length === 0) ? '<p style="color:var(--danger)">Nada para importar.</p>' : ''}
    `;
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        ${(novos.length || atualizacoes.length) ? '<button class="btn btn-success" onclick="confirmarImportacao()">Confirmar importação</button>' : ''}
    `;
    openModal('Prévia da importação', body, footer);
}

async function confirmarImportacao() {
    if (!importPreview) return;
    const { novos, atualizacoes } = importPreview;
    try {
        // 1) Criar categorias que ainda não existem
        const nomesCategorias = [...new Set([...novos, ...atualizacoes].map(i => i.categoria).filter(Boolean))];
        for (const catNome of nomesCategorias) {
            const existe = cache.categorias.find(c => c.nome.toLowerCase() === catNome.toLowerCase());
            if (!existe) {
                const { error } = await supabaseClient.from('categorias').insert({ nome: catNome, icone: '📦' });
                if (error && !String(error.message).includes('duplicate')) console.warn('Categoria:', error);
            }
        }
        await loadCategorias();
        const catId = (nome) => {
            if (!nome) return null;
            const c = cache.categorias.find(x => x.nome.toLowerCase() === nome.toLowerCase());
            return c ? c.id : null;
        };

        // 2) Inserir novos
        if (novos.length) {
            const rows = novos.map(i => ({
                nome: i.nome, codigo: i.codigo, categoria_id: catId(i.categoria),
                estoque: i.estoque, estoque_minimo: i.minimo, unidade: i.unidade,
                consumo_diario: i.consumo, icone: '📦', ativo: true
            }));
            const { error } = await supabaseClient.from('produtos').insert(rows);
            if (error) throw error;
        }

        // 3) Atualizar existentes — SEM alterar o estoque
        for (const i of atualizacoes) {
            const { error } = await supabaseClient.from('produtos').update({
                nome: i.nome, codigo: i.codigo, categoria_id: catId(i.categoria),
                estoque_minimo: i.minimo, unidade: i.unidade, consumo_diario: i.consumo
            }).eq('id', i.existenteId);
            if (error) throw error;
        }

        showToast(`Importação concluída: ${novos.length} novos, ${atualizacoes.length} atualizados.`, 'success');
        importPreview = null;
        closeModal();
        await loadProdutos();
        renderPage();
    } catch (error) {
        console.error('Erro na importação:', error);
        showToast('Erro na importação: ' + (error.message || 'verifique o console'), 'error');
    }
}

async function salvarProduto() {
    const nome = document.getElementById('prod-nome').value.trim();
    const codigo = document.getElementById('prod-codigo').value.trim() || null;
    const ean = document.getElementById('prod-ean').value.trim() || null;
    const fator = Math.max(1, parseInt(document.getElementById('prod-fator').value) || 1);
    const icone = document.getElementById('prod-icone').value.trim() || '📦';
    const categoria = document.getElementById('prod-categoria').value;
    const estoque = parseInt(document.getElementById('prod-estoque').value) || 0;
    const minimo = parseInt(document.getElementById('prod-minimo').value) || 10;
    const unidade = document.getElementById('prod-unidade').value;
    const consumoModo = document.getElementById('prod-consumo-modo').value === 'manual' ? 'manual' : 'automatico';
    const consumo = consumoModo === 'manual' ? (parseFloat(document.getElementById('prod-consumo').value) || 0) : 0;
    
    if (!nome) {
        showToast('Digite o nome do produto', 'error');
        return;
    }
    
    if (!categoria) {
        showToast('Selecione uma categoria', 'error');
        return;
    }
    
    try {
        const { data, error } = await supabaseClient
            .from('produtos')
            .insert({
                nome,
                codigo,
                ean,
                icone,
                categoria_id: parseInt(categoria),
                estoque,
                estoque_minimo: minimo,
                unidade,
                consumo_diario: consumo,
                consumo_modo: consumoModo,
                fator_embalagem: fator,
                ativo: true
            })
            .select()
            .single();
        
        if (error) throw error;
        
        showToast('Produto cadastrado com sucesso!', 'success');
        
        // Atualizar cache
        await loadProdutos();
        
        // Limpar formulário
        document.getElementById('prod-nome').value = '';
        document.getElementById('prod-codigo').value = '';
        document.getElementById('prod-ean').value = '';
        document.getElementById('prod-fator').value = '1';
        document.getElementById('prod-consumo-modo').value = 'automatico';
        document.getElementById('prod-consumo').value = '0';
        document.getElementById('prod-consumo').disabled = true;
        document.getElementById('prod-icone').value = '📦';
        document.getElementById('prod-categoria').value = '';
        document.getElementById('prod-estoque').value = '0';
        document.getElementById('prod-minimo').value = '10';
        document.getElementById('prod-consumo').value = '1';
        
        renderPage();
        
    } catch (error) {
        console.error('Erro ao cadastrar produto:', error);
        showToast('Erro ao cadastrar produto: ' + (error.message || ''), 'error');
    }
}

function openEditProdutoModal(produtoId) {
    const produto = cache.produtos.find(p => p.id === produtoId);
    if (!produto) return;
    
    const body = `
        <div class="form-group">
            <label>Nome do Produto *</label>
            <input type="text" id="edit-prod-nome" class="form-input" value="${produto.nome}">
        </div>
        
        <div class="form-group">
            <label>Código interno</label>
            <input type="text" id="edit-prod-codigo" class="form-input" value="${produto.codigo || ''}" placeholder="opcional">
        </div>
        
        <div class="form-group">
            <label>Código de barras (EAN)</label>
            <input type="text" id="edit-prod-ean" class="form-input" value="${produto.ean || ''}" placeholder="opcional">
        </div>
        
        <div class="form-group">
            <label>Unidades por embalagem de compra</label>
            <input type="number" id="edit-prod-fator" class="form-input" value="${produto.fator_embalagem || 1}" min="1">
        </div>
        
        <div class="form-group">
            <label>Ícone (emoji)</label>
            <input type="text" id="edit-prod-icone" class="form-input" value="${produto.icone}" maxlength="2">
        </div>
        
        <div class="form-group">
            <label>Categoria</label>
            <select id="edit-prod-categoria" class="form-input">
                ${cache.categorias.map(c => `
                    <option value="${c.id}" ${c.id === produto.categoria_id ? 'selected' : ''}>
                        ${c.icone} ${c.nome}
                    </option>
                `).join('')}
            </select>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="form-group">
                <label>Estoque Mínimo</label>
                <input type="number" id="edit-prod-minimo" class="form-input" value="${produto.estoque_minimo}" min="1">
            </div>
            
            <div class="form-group">
                <label>Consumo Diário</label>
                <select id="edit-prod-consumo-modo" class="form-input" onchange="document.getElementById('edit-prod-consumo').disabled = (this.value !== 'manual')">
                    <option value="automatico" ${(produto.consumo_modo || 'automatico') !== 'manual' ? 'selected' : ''}>Automático (${(consumoEfetivo(produto)).toFixed(2)}/dia)</option>
                    <option value="manual" ${produto.consumo_modo === 'manual' ? 'selected' : ''}>Manual (valor fixo)</option>
                </select>
                <input type="number" id="edit-prod-consumo" class="form-input" value="${produto.consumo_diario || 0}" step="0.1" min="0" style="margin-top:8px;" ${produto.consumo_modo === 'manual' ? '' : 'disabled'}>
            </div>
        </div>
        
        <div class="form-group">
            <label>Unidade</label>
            <select id="edit-prod-unidade" class="form-input">
                <option value="un" ${produto.unidade === 'un' ? 'selected' : ''}>Unidade (un)</option>
                <option value="cx" ${produto.unidade === 'cx' ? 'selected' : ''}>Caixa (cx)</option>
                <option value="pct" ${produto.unidade === 'pct' ? 'selected' : ''}>Pacote (pct)</option>
                <option value="kg" ${produto.unidade === 'kg' ? 'selected' : ''}>Quilograma (kg)</option>
                <option value="lt" ${produto.unidade === 'lt' ? 'selected' : ''}>Litro (lt)</option>
            </select>
        </div>
        
        <div style="border-top: 1px solid var(--gray-200); margin-top: 16px; padding-top: 16px;">
            <p style="color: var(--gray-500); font-size: 14px; margin-bottom: 12px;">⚠️ Ações perigosas:</p>
            <div style="display: flex; gap: 12px;">
                <button class="btn btn-warning" onclick="desativarProduto(${produtoId})" style="flex: 1;">
                    🚫 Desativar
                </button>
                <button class="btn btn-danger" onclick="excluirProduto(${produtoId})" style="flex: 1;">
                    🗑️ Excluir
                </button>
            </div>
        </div>
    `;
    
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="atualizarProduto(${produtoId})">Salvar</button>
    `;
    
    openModal('Editar Produto', body, footer);
}

async function atualizarProduto(produtoId) {
    const nome = document.getElementById('edit-prod-nome').value.trim();
    const codigo = document.getElementById('edit-prod-codigo').value.trim() || null;
    const ean = document.getElementById('edit-prod-ean').value.trim() || null;
    const fator = Math.max(1, parseInt(document.getElementById('edit-prod-fator').value) || 1);
    const icone = document.getElementById('edit-prod-icone').value.trim();
    const categoria = document.getElementById('edit-prod-categoria').value;
    const minimo = parseInt(document.getElementById('edit-prod-minimo').value);
    const consumoModo = document.getElementById('edit-prod-consumo-modo').value === 'manual' ? 'manual' : 'automatico';
    const consumo = consumoModo === 'manual' ? (parseFloat(document.getElementById('edit-prod-consumo').value) || 0) : (parseFloat(document.getElementById('edit-prod-consumo').value) || 0);
    const unidade = document.getElementById('edit-prod-unidade').value;
    
    if (!nome) {
        showToast('Digite o nome do produto', 'error');
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('produtos')
            .update({
                nome,
                codigo,
                ean,
                icone,
                categoria_id: parseInt(categoria),
                estoque_minimo: minimo,
                consumo_diario: consumo,
                consumo_modo: consumoModo,
                unidade,
                fator_embalagem: fator
            })
            .eq('id', produtoId);
        
        if (error) throw error;
        
        showToast('Produto atualizado!', 'success');
        closeModal();
        await loadProdutos();
        renderPage();
        
    } catch (error) {
        console.error('Erro ao atualizar produto:', error);
        showToast('Erro ao atualizar produto: ' + (error.message || ''), 'error');
    }
}

async function desativarProduto(produtoId) {
    const produto = cache.produtos.find(p => p.id === produtoId);
    
    const confirmado = confirm(`Deseja desativar o produto "${produto?.nome}"?\n\nO produto não aparecerá mais nas listagens, mas o histórico será mantido.`);
    
    if (!confirmado) return;
    
    try {
        const { error } = await supabaseClient
            .from('produtos')
            .update({ ativo: false })
            .eq('id', produtoId);
        
        if (error) throw error;
        
        showToast('Produto desativado!', 'success');
        closeModal();
        await loadProdutos();
        renderPage();
        
    } catch (error) {
        console.error('Erro ao desativar produto:', error);
        showToast('Erro ao desativar produto', 'error');
    }
}

async function excluirProduto(produtoId) {
    const produto = cache.produtos.find(p => p.id === produtoId);
    
    const confirmado = confirm(`⚠️ ATENÇÃO: Deseja EXCLUIR PERMANENTEMENTE o produto "${produto?.nome}"?\n\nEsta ação não pode ser desfeita e pode afetar o histórico de movimentações.`);
    
    if (!confirmado) return;
    
    // Segunda confirmação para exclusão
    const confirmado2 = confirm(`Tem certeza? Digite OK para confirmar a exclusão permanente.`);
    
    if (!confirmado2) return;
    
    try {
        // Primeiro, excluir QR codes relacionados
        await supabaseClient
            .from('qrcodes')
            .delete()
            .eq('produto_id', produtoId);
        
        // Excluir avaliações relacionadas
        await supabaseClient
            .from('avaliacoes')
            .delete()
            .eq('produto_id', produtoId);
        
        // Excluir o produto
        const { error } = await supabaseClient
            .from('produtos')
            .delete()
            .eq('id', produtoId);
        
        if (error) throw error;
        
        showToast('Produto excluído permanentemente!', 'success');
        closeModal();
        await loadProdutos();
        renderPage();
        
    } catch (error) {
        console.error('Erro ao excluir produto:', error);
        showToast('Erro ao excluir: ' + error.message, 'error');
    }
}

// ============================================
// GERENCIAMENTO DE COLABORADORES (ADMIN)
// ============================================
async function loadColaboradores() {
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('id, nome, email, role, setor, ativo, avatar_url, created_at, updated_at')
            .order('nome');
        
        if (error) throw error;
        cache.colaboradores = data || [];
    } catch (error) {
        console.error('Erro ao carregar colaboradores:', error);
        cache.colaboradores = [];
    }
}

function renderColaboradores() {
    if (currentProfile?.role !== 'admin') {
        return `
            <div class="empty-state">
                <div class="icon">🔒</div>
                <h3>Acesso Restrito</h3>
                <p>Apenas administradores podem gerenciar colaboradores.</p>
            </div>
        `;
    }
    
    const ativos = cache.colaboradores.filter(c => c.ativo !== false);
    const inativos = cache.colaboradores.filter(c => c.ativo === false);
    
    return `
        <div class="page-header">
            <div class="page-header-row" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div class="page-title">Colaboradores</div>
                    <div class="page-subtitle">${ativos.length} ativos</div>
                </div>
                <button class="btn btn-primary" onclick="openNovoColaboradorModal()">
                    👤 Novo
                </button>
            </div>
        </div>
        
        <div class="card">
            <div class="card-title">👥 Colaboradores Ativos</div>
            
            ${ativos.length === 0 ? `
                <div class="empty-state" style="padding: 30px;">
                    <div class="icon">👥</div>
                    <p>Nenhum colaborador cadastrado</p>
                </div>
            ` : ativos.map(c => `
                <div class="list-item" onclick="openEditColaboradorModal('${c.id}')">
                    <div class="avatar" style="width: 40px; height: 40px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-weight: bold;">
                        ${c.nome?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div class="list-item-content">
                        <div class="list-item-title">${c.nome || 'Sem nome'}</div>
                        <div class="list-item-subtitle">${c.email || ''}</div>
                    </div>
                    <div class="list-item-right">
                        <span class="badge ${c.role === 'admin' ? 'badge-info' : 'badge-success'}">
                            ${c.role === 'admin' ? 'Admin' : 'Colaborador'}
                        </span>
                    </div>
                </div>
            `).join('')}
        </div>
        
        ${inativos.length > 0 ? `
            <div class="card">
                <div class="card-title">🚫 Colaboradores Inativos</div>
                ${inativos.map(c => `
                    <div class="list-item" style="opacity: 0.6;" onclick="openEditColaboradorModal('${c.id}')">
                        <div class="avatar" style="width: 40px; height: 40px; border-radius: 50%; background: var(--gray-400); color: white; display: flex; align-items: center; justify-content: center; font-weight: bold;">
                            ${c.nome?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div class="list-item-content">
                            <div class="list-item-title">${c.nome || 'Sem nome'}</div>
                            <div class="list-item-subtitle">${c.email || ''}</div>
                        </div>
                        <span class="badge badge-danger">Inativo</span>
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;
}

function openNovoColaboradorModal() {
    const body = `
        <div class="form-group">
            <label>Nome Completo *</label>
            <input type="text" id="colab-nome" class="form-input" placeholder="Nome do colaborador">
        </div>
        
        <div class="form-group">
            <label>Email *</label>
            <input type="email" id="colab-email" class="form-input" placeholder="email@empresa.com">
        </div>
        
        <div class="form-group">
            <label>Senha Inicial *</label>
            <input type="password" id="colab-senha" class="form-input" placeholder="Mínimo 6 caracteres">
        </div>
        
        <div class="form-group">
            <label>Confirmar Senha *</label>
            <input type="password" id="colab-senha2" class="form-input" placeholder="Digite a senha novamente">
            <small style="color: var(--gray-500); display: block; margin-top: 4px;">
                O colaborador poderá alterar depois
            </small>
        </div>
        
        <div class="form-group">
            <label>Setor</label>
            <input type="text" id="colab-setor" class="form-input" placeholder="Ex: Administrativo, TI, RH...">
        </div>
        
        <div class="form-group">
            <label>Tipo de Acesso</label>
            <select id="colab-role" class="form-input">
                <option value="colaborador">Colaborador (apenas consumo)</option>
                <option value="admin">Administrador (acesso total)</option>
            </select>
        </div>
    `;
    
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="criarColaborador()">Criar Colaborador</button>
    `;
    
    openModal('Novo Colaborador', body, footer);
}

// Cliente secundário só para criar usuários. Sem persistir sessão, para que
// criar um colaborador NÃO troque/derrube a sessão do admin que está logado.
let _signupClient = null;
function getSignupClient() {
    if (_signupClient) return _signupClient;
    _signupClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    return _signupClient;
}

async function criarColaborador() {
    const nome = document.getElementById('colab-nome').value.trim();
    const email = document.getElementById('colab-email').value.trim();
    const senha = document.getElementById('colab-senha').value;
    const senha2 = document.getElementById('colab-senha2').value;
    const setor = document.getElementById('colab-setor').value.trim();
    const role = document.getElementById('colab-role').value;
    
    // Validações
    if (!nome) {
        showToast('Digite o nome do colaborador', 'error');
        return;
    }
    
    if (!email) {
        showToast('Digite o email', 'error');
        return;
    }
    
    if (!isEmailValido(email)) {
        showToast('Digite um email válido (ex: nome@empresa.com)', 'error');
        return;
    }
    
    if (!senha || senha.length < 6) {
        showToast('A senha deve ter no mínimo 6 caracteres', 'error');
        return;
    }
    
    if (senha !== senha2) {
        showToast('As senhas não conferem', 'error');
        return;
    }
    
    try {
        showToast('Criando colaborador...', '');
        
        // Criar usuário via signup (cliente secundário não afeta a sessão do admin)
        const { data: signupData, error: signupError } = await getSignupClient().auth.signUp({
            email,
            password: senha,
            options: {
                data: {
                    nome,
                    setor,
                    role
                }
            }
        });
        
        if (signupError) throw signupError;
        
        // Atualizar profile com dados adicionais
        if (signupData.user) {
            const { error: profileError } = await supabaseClient
                .from('profiles')
                .upsert({
                    id: signupData.user.id,
                    nome,
                    email,
                    setor,
                    role,
                    ativo: true
                });
            
            if (profileError) throw profileError;
        }
        
        showToast('Colaborador criado com sucesso!', 'success');
        closeModal();
        await loadColaboradores();
        renderPage();
        
    } catch (error) {
        console.error('Erro ao criar colaborador:', error);
        const msg = error.message || '';
        if (msg.includes('already registered') || msg.includes('already been registered')) {
            showToast('Este email já está cadastrado', 'error');
        } else if (msg.toLowerCase().includes('rate limit')) {
            showToast('Limite de emails do Supabase atingido. Veja a observação para resolver.', 'error');
        } else {
            showToast('Erro ao criar colaborador: ' + msg, 'error');
        }
    }
}

function openEditColaboradorModal(colabId) {
    const colab = cache.colaboradores.find(c => c.id === colabId);
    if (!colab) return;
    
    const isAtivo = colab.ativo !== false;
    const isCurrentUser = colab.id === currentUser?.id;
    
    const body = `
        <div class="form-group">
            <label>Nome Completo</label>
            <input type="text" id="edit-colab-nome" class="form-input" value="${colab.nome || ''}">
        </div>
        
        <div class="form-group">
            <label>Email</label>
            <input type="email" id="edit-colab-email" class="form-input" value="${colab.email || ''}" disabled>
            <small style="color: var(--gray-500);">O email não pode ser alterado</small>
        </div>
        
        <div class="form-group">
            <label>Setor</label>
            <input type="text" id="edit-colab-setor" class="form-input" value="${colab.setor || ''}">
        </div>
        
        <div class="form-group">
            <label>Tipo de Acesso</label>
            <select id="edit-colab-role" class="form-input" ${isCurrentUser ? 'disabled' : ''}>
                <option value="colaborador" ${colab.role !== 'admin' ? 'selected' : ''}>Colaborador</option>
                <option value="admin" ${colab.role === 'admin' ? 'selected' : ''}>Administrador</option>
            </select>
            ${isCurrentUser ? '<small style="color: var(--gray-500);">Você não pode alterar seu próprio tipo de acesso</small>' : ''}
        </div>
        
        <div class="form-group">
            <label>Status</label>
            <select id="edit-colab-ativo" class="form-input" ${isCurrentUser ? 'disabled' : ''}>
                <option value="true" ${isAtivo ? 'selected' : ''}>✅ Ativo</option>
                <option value="false" ${!isAtivo ? 'selected' : ''}>🚫 Inativo</option>
            </select>
        </div>
        
        ${!isCurrentUser ? `
            <div style="border-top: 1px solid var(--gray-200); margin-top: 16px; padding-top: 16px;">
                <p style="color: var(--gray-500); font-size: 14px; margin-bottom: 12px;">⚠️ Ação perigosa:</p>
                <button class="btn btn-danger" onclick="excluirColaborador('${colabId}')" style="width: 100%;">
                    🗑️ Excluir Colaborador
                </button>
            </div>
        ` : ''}
    `;
    
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="atualizarColaborador('${colabId}')">Salvar</button>
    `;
    
    openModal('Editar Colaborador', body, footer);
}

async function atualizarColaborador(colabId) {
    const nome = document.getElementById('edit-colab-nome').value.trim();
    const setor = document.getElementById('edit-colab-setor').value.trim();
    const role = document.getElementById('edit-colab-role').value;
    const ativo = document.getElementById('edit-colab-ativo').value === 'true';
    
    if (!nome) {
        showToast('Digite o nome', 'error');
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('profiles')
            .update({
                nome,
                setor,
                role,
                ativo
            })
            .eq('id', colabId);
        
        if (error) throw error;
        
        showToast('Colaborador atualizado!', 'success');
        closeModal();
        await loadColaboradores();
        renderPage();
        
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao atualizar', 'error');
    }
}

async function excluirColaborador(colabId) {
    const colab = cache.colaboradores.find(c => c.id === colabId);
    
    if (colabId === currentUser?.id) {
        showToast('Você não pode excluir a si mesmo!', 'error');
        return;
    }
    
    const confirmado = confirm(`⚠️ ATENÇÃO: Deseja EXCLUIR o colaborador "${colab?.nome}"?\n\nO perfil será removido, mas o usuário de autenticação permanecerá (pode ser removido manualmente no Supabase).`);
    
    if (!confirmado) return;
    
    try {
        const { error } = await supabaseClient
            .from('profiles')
            .delete()
            .eq('id', colabId);
        
        if (error) throw error;
        
        showToast('Colaborador excluído!', 'success');
        closeModal();
        await loadColaboradores();
        renderPage();
        
    } catch (error) {
        console.error('Erro ao excluir colaborador:', error);
        showToast('Erro ao excluir: ' + error.message, 'error');
    }
}

