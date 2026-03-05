// ============================================
// OFFICESUPPLIES - APLICAÇÃO PRINCIPAL
// ============================================

// Configuração do Supabase
const SUPABASE_URL = 'https://egtbnjpbnafaeajypmtz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVndGJuanBibmFmYWVhanlwbXR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTUzNzcsImV4cCI6MjA4ODEzMTM3N30.Yb9ERrPpAQOy8cuPFmEEB7zZALR6Zjt1J_psPAcpgMM';

// Inicializar Supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

// Cache de dados
let cache = {
    produtos: [],
    categorias: [],
    movimentacoes: [],
    alertas: [],
    sugestoes: [],
    fornecedores: [],
    avaliacoes: {}
};

// Títulos das páginas
const PAGE_TITLES = {
    home: 'Início',
    produtos: 'Produtos',
    estoque: 'Estoque',
    historico: 'Histórico',
    sugestoes: 'Sugestões',
    alertas: 'Alertas',
    entrada: 'Entrada de Estoque',
    fornecedores: 'Fornecedores',
    compras: 'Lista de Compras',
    relatorios: 'Relatórios',
    mais: 'Mais Opções',
    'cadastro-produto': 'Cadastrar Produto',
    'colaboradores': 'Colaboradores'
};

// ============================================
// INICIALIZAÇÃO
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
});

async function checkAuth() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        if (session) {
            currentUser = session.user;
            await loadUserProfile();
            await initApp();
        } else {
            showLogin();
        }
    } catch (error) {
        console.error('Erro ao verificar autenticação:', error);
        showLogin();
    }
}

// Listener para mudanças de autenticação
supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
        currentUser = session.user;
        await loadUserProfile();
        await initApp();
    } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        currentProfile = null;
        showLogin();
    }
});

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

// Login form
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const btn = document.getElementById('login-btn');
    const errorEl = document.getElementById('login-error');
    
    btn.disabled = true;
    btn.innerHTML = '<span>Entrando...</span>';
    errorEl.classList.remove('show');
    
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        // O listener onAuthStateChange vai cuidar do resto
    } catch (error) {
        console.error('Erro no login:', error);
        errorEl.textContent = getErrorMessage(error);
        errorEl.classList.add('show');
        btn.disabled = false;
        btn.innerHTML = '<span>Entrar</span>';
    }
});

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
            .single();
        
        if (error) throw error;
        currentProfile = data;
    } catch (error) {
        console.error('Erro ao carregar perfil:', error);
    }
}

async function initApp() {
    showLoading();
    
    // Atualizar UI do usuário
    updateUserUI();
    
    // Carregar dados iniciais
    await Promise.all([
        loadCategorias(),
        loadProdutos(),
        loadAlertas(),
        loadAvaliacoes()
    ]);
    
    // Atualizar badges
    updateBadges();
    
    // Mostrar app
    showApp();
    
    // Renderizar página inicial
    navigate('home');
    
    // Setup Push Notifications
    setupPushNotifications();
}

function updateUserUI() {
    const nome = currentProfile?.nome || currentUser.email.split('@')[0];
    const inicial = nome.charAt(0).toUpperCase();
    const isAdmin = currentProfile?.role === 'admin';
    
    document.getElementById('user-name').textContent = nome.split(' ')[0];
    document.getElementById('user-role').textContent = isAdmin ? 'Administrador' : 'Colaborador';
    document.getElementById('user-avatar').textContent = inicial;
    
    // Mostrar/ocultar seção admin
    const adminSection = document.getElementById('sidebar-admin-section');
    if (adminSection) {
        adminSection.style.display = isAdmin ? 'block' : 'none';
    }
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
    } catch (error) {
        console.error('Erro ao carregar sugestões:', error);
    }
}

async function loadMovimentacoes() {
    try {
        const { data, error } = await supabaseClient
            .from('movimentacoes')
            .select(`
                *,
                produtos (nome, icone),
                profiles (nome)
            `)
            .order('created_at', { ascending: false })
            .limit(100);
        
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
    currentPage = page;
    currentCategory = 0;
    searchQuery = '';
    
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
            case 'entrada':
                main.innerHTML = renderEntrada();
                break;
            case 'fornecedores':
                await loadFornecedores();
                main.innerHTML = renderFornecedores();
                break;
            case 'compras':
                main.innerHTML = renderCompras();
                break;
            case 'relatorios':
                main.innerHTML = renderRelatorios();
                break;
            case 'mais':
                main.innerHTML = renderMais();
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
    const hoje = new Date().toISOString().split('T')[0];
    
    // Buscar consumo de hoje
    const { data: consumoHoje } = await supabaseClient
        .from('movimentacoes')
        .select('quantidade')
        .eq('tipo', 'saida')
        .gte('created_at', hoje + 'T00:00:00')
        .lte('created_at', hoje + 'T23:59:59');
    
    const totalConsumo = (consumoHoje || []).reduce((sum, m) => sum + m.quantidade, 0);
    const estoqueBaixo = cache.produtos.filter(p => p.estoque <= p.estoque_minimo).length;
    const alertasPendentes = cache.alertas.filter(a => !a.resolvido).length;
    
    // Buscar últimas movimentações
    const { data: ultimas } = await supabaseClient
        .from('movimentacoes')
        .select(`
            *,
            produtos (nome, icone),
            profiles (nome)
        `)
        .order('created_at', { ascending: false })
        .limit(5);
    
    const nome = currentProfile?.nome?.split(' ')[0] || 'Usuário';
    
    return `
        <div class="page-header">
            <div class="page-title">Olá, ${nome}! 👋</div>
            <div class="page-subtitle">${getGreeting()}</div>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card" onclick="navigate('produtos')">
                <div class="stat-icon">🛒</div>
                <div class="stat-value">${totalConsumo}</div>
                <div class="stat-label">Pegos hoje</div>
            </div>
            <div class="stat-card" onclick="navigate('produtos')">
                <div class="stat-icon">📦</div>
                <div class="stat-value">${cache.produtos.length}</div>
                <div class="stat-label">Produtos</div>
            </div>
            <div class="stat-card ${estoqueBaixo > 0 ? 'pulse' : ''}" onclick="navigate('estoque')">
                <div class="stat-icon">📉</div>
                <div class="stat-value" style="color: ${estoqueBaixo > 0 ? 'var(--danger)' : ''}">${estoqueBaixo}</div>
                <div class="stat-label">Estoque baixo</div>
            </div>
            <div class="stat-card" onclick="navigate('alertas')">
                <div class="stat-icon">⚠️</div>
                <div class="stat-value">${alertasPendentes}</div>
                <div class="stat-label">Alertas</div>
            </div>
        </div>
        
        <div class="two-column">
            <div class="card">
                <div class="card-title">⚡ Ações Rápidas</div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                    <button class="btn btn-primary" onclick="navigate('produtos')">📦 Ver Produtos</button>
                    <button class="btn btn-secondary" onclick="navigate('estoque')">📊 Ver Estoque</button>
                    <button class="btn btn-secondary" onclick="openSugestaoModal()">💡 Sugerir</button>
                    <button class="btn btn-secondary" onclick="openAlertaModal()">⚠️ Alertar</button>
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
    
    return `
        <div class="product-card ${isLow ? 'low-stock' : ''}" onclick="openProductModal(${p.id})">
            <button class="quick-btn" onclick="event.stopPropagation(); quickConsume(${p.id})" title="Pegar 1">+</button>
            <div class="product-icon">${p.icone}</div>
            <div class="product-name">${p.nome}</div>
            <div class="product-stock ${isLow ? 'danger' : ''}">${p.estoque} ${p.unidade}</div>
            <div class="stock-bar">
                <div class="stock-fill ${fillClass}" style="width: ${pct}%"></div>
            </div>
            <div class="product-rating">
                <span class="rating-item like">👍 ${p.likes || 0}</span>
                <span class="rating-item dislike">👎 ${p.dislikes || 0}</span>
            </div>
        </div>
    `;
}

// ============================================
// RENDERIZAÇÃO - ESTOQUE
// ============================================
async function renderEstoque() {
    const sorted = [...cache.produtos].sort((a, b) => {
        const diasA = a.consumo_diario > 0 ? a.estoque / a.consumo_diario : 999;
        const diasB = b.consumo_diario > 0 ? b.estoque / b.consumo_diario : 999;
        return diasA - diasB;
    });
    
    return `
        <div class="page-header">
            <div class="page-title">Estoque</div>
            <div class="page-subtitle">Ordenado por urgência</div>
        </div>
        
        ${sorted.map(p => {
            const dias = p.consumo_diario > 0 ? Math.round(p.estoque / p.consumo_diario) : '∞';
            const isLow = p.estoque <= p.estoque_minimo;
            const valueClass = isLow ? 'danger' : p.estoque <= p.estoque_minimo * 1.5 ? 'warning' : 'success';
            
            return `
                <div class="list-item" onclick="openProductModal(${p.id})">
                    <div class="list-item-icon">${p.icone}</div>
                    <div class="list-item-content">
                        <div class="list-item-title">${p.nome}</div>
                        <div class="list-item-subtitle">~${p.consumo_diario || 0}/${p.unidade}/dia • Mín: ${p.estoque_minimo}</div>
                    </div>
                    <div class="list-item-right">
                        <div class="list-item-value ${valueClass}">${p.estoque}</div>
                        <div class="list-item-unit">~${dias} dias</div>
                    </div>
                </div>
            `;
        }).join('')}
    `;
}

// ============================================
// RENDERIZAÇÃO - HISTÓRICO
// ============================================
function renderHistorico() {
    return `
        <div class="page-header">
            <div class="page-title">Histórico</div>
            <div class="page-subtitle">${cache.movimentacoes.length} movimentações</div>
        </div>
        
        <div class="tabs">
            <button class="tab active" onclick="filterHistorico('todos', this)">Todos</button>
            <button class="tab" onclick="filterHistorico('entrada', this)">Entradas</button>
            <button class="tab" onclick="filterHistorico('saida', this)">Saídas</button>
        </div>
        
        <div class="card">
            <div class="history-list" id="historico-list">
                ${renderHistoricoList(cache.movimentacoes)}
            </div>
        </div>
    `;
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
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    
    let filtered = cache.movimentacoes;
    if (tipo !== 'todos') {
        filtered = filtered.filter(m => m.tipo === tipo);
    }
    
    document.getElementById('historico-list').innerHTML = renderHistoricoList(filtered);
}
// ============================================
// RENDERIZAÇÃO - SUGESTÕES
// ============================================
function renderSugestoes() {
    const isAdmin = currentProfile?.role === 'admin';
    const pendentes = cache.sugestoes.filter(s => s.status === 'pendente');
    const outras = cache.sugestoes.filter(s => s.status !== 'pendente');
    
    return `
        <div class="page-header">
            <div class="page-header-row">
                <div>
                    <div class="page-title">Sugestões</div>
                    <div class="page-subtitle">${pendentes.length} pendentes</div>
                </div>
                <div class="page-actions">
                    <button class="btn btn-primary btn-sm" onclick="openSugestaoModal()">💡 Nova Sugestão</button>
                </div>
            </div>
        </div>
        
        ${pendentes.length > 0 ? `
            <div class="card">
                <div class="card-title">📬 Pendentes</div>
                ${pendentes.map(s => renderSugestaoItem(s, isAdmin)).join('')}
            </div>
        ` : ''}
        
        ${outras.length > 0 ? `
            <div class="card">
                <div class="card-title">📋 Histórico</div>
                ${outras.map(s => renderSugestaoItem(s, false)).join('')}
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

function renderSugestaoItem(s, showActions) {
    const statusBadge = {
        pendente: '<span class="badge badge-warning">Pendente</span>',
        aprovada: '<span class="badge badge-success">Aprovada</span>',
        rejeitada: '<span class="badge badge-danger">Rejeitada</span>'
    };
    
    return `
        <div class="list-item" style="cursor: default;">
            <div class="list-item-icon">${s.categorias?.icone || '📦'}</div>
            <div class="list-item-content">
                <div class="list-item-title">${s.nome}</div>
                <div class="list-item-subtitle">
                    ${s.profiles?.nome || 'Usuário'} • ${formatDate(s.created_at)}
                    ${s.justificativa ? `<br><em>"${s.justificativa}"</em>` : ''}
                </div>
            </div>
            <div class="list-item-right">
                ${statusBadge[s.status]}
                ${showActions ? `
                    <div style="margin-top: 8px; display: flex; gap: 8px;">
                        <button class="btn btn-success btn-sm" onclick="respondSugestao(${s.id}, 'aprovada')" style="padding: 6px 12px;">✓</button>
                        <button class="btn btn-danger btn-sm" onclick="respondSugestao(${s.id}, 'rejeitada')" style="padding: 6px 12px;">✗</button>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

async function respondSugestao(id, status) {
    try {
        const { error } = await supabaseClient
            .from('sugestoes')
            .update({
                status,
                respondido_por: currentUser.id,
                respondido_em: new Date().toISOString()
            })
            .eq('id', id);
        
        if (error) throw error;
        
        showToast(status === 'aprovada' ? 'Sugestão aprovada!' : 'Sugestão rejeitada', 'success');
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
    const pendentes = cache.alertas.filter(a => !a.resolvido);
    const resolvidos = cache.alertas.filter(a => a.resolvido);
    
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
        
        ${resolvidos.length > 0 ? `
            <div class="card">
                <div class="card-title">✅ Resolvidos</div>
                ${resolvidos.slice(0, 10).map(a => renderAlertaItem(a, false)).join('')}
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
    
    return `
        <div class="list-item" style="cursor: default; ${a.resolvido ? 'opacity: 0.6;' : ''}">
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
                ${showActions && !a.resolvido ? `
                    <button class="btn btn-success btn-sm mt-2" onclick="resolveAlerta(${a.id})" style="padding: 6px 12px;">Resolver</button>
                ` : ''}
            </div>
        </div>
    `;
}

async function resolveAlerta(id) {
    try {
        const { error } = await supabaseClient
            .from('alertas')
            .update({
                resolvido: true,
                resolvido_por: currentUser.id,
                resolvido_em: new Date().toISOString()
            })
            .eq('id', id);
        
        if (error) throw error;
        
        showToast('Alerta resolvido!', 'success');
        await loadAlertas();
        updateBadges();
        renderPage();
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao resolver alerta', 'error');
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
function renderCompras() {
    const itensCompra = cache.produtos
        .filter(p => p.estoque <= p.estoque_minimo * 1.2)
        .map(p => {
            const diasCobertura = 30;
            const consumoDiario = p.consumo_diario || 0.5;
            const necessario = Math.ceil(consumoDiario * diasCobertura);
            const comprar = Math.max(0, necessario - p.estoque);
            return { ...p, comprar, consumoDiario };
        })
        .filter(p => p.comprar > 0)
        .sort((a, b) => b.comprar - a.comprar);
    
    return `
        <div class="page-header">
            <div class="page-header-row">
                <div>
                    <div class="page-title">Lista de Compras</div>
                    <div class="page-subtitle">${itensCompra.length} itens para comprar</div>
                </div>
                <div class="page-actions">
                    <button class="btn btn-secondary btn-sm" onclick="exportComprasPDF()">📄 PDF</button>
                    <button class="btn btn-secondary btn-sm" onclick="exportComprasExcel()">📊 Excel</button>
                </div>
            </div>
        </div>
        
        ${itensCompra.length === 0 ? `
            <div class="empty-state">
                <div class="icon">✅</div>
                <h3>Estoque em dia!</h3>
                <p>Não há necessidade de compras no momento</p>
            </div>
        ` : `
            <div class="card mb-4">
                <div class="card-title">⚙️ Configurações</div>
                <div class="config-grid">
                    <div class="config-item">
                        <label>Dias de Cobertura</label>
                        <input type="number" id="dias-cobertura" value="30" onchange="renderPage()">
                        <small>Estoque para quantos dias</small>
                    </div>
                    <div class="config-item">
                        <label>Margem de Segurança</label>
                        <input type="number" id="margem-seguranca" value="20" onchange="renderPage()">
                        <small>% adicional</small>
                    </div>
                </div>
            </div>
            
            <div id="lista-compras">
                ${itensCompra.map(p => `
                    <div class="shopping-item">
                        <div class="shopping-item-icon">${p.icone}</div>
                        <div class="shopping-item-info">
                            <div class="shopping-item-name">${p.nome}</div>
                            <div class="shopping-item-meta">
                                Estoque: ${p.estoque} • Consumo: ${p.consumoDiario}/${p.unidade}/dia
                            </div>
                        </div>
                        <div class="shopping-item-qty">
                            <div class="value">${p.comprar}</div>
                            <div class="unit">${p.unidade}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `}
    `;
}

// ============================================
// RENDERIZAÇÃO - RELATÓRIOS
// ============================================
function renderRelatorios() {
    return `
        <div class="page-header">
            <div class="page-title">Relatórios</div>
            <div class="page-subtitle">Exporte dados do sistema</div>
        </div>
        
        <div class="card">
            <div class="card-title">📊 Relatórios Disponíveis</div>
            
            <div class="list-item" onclick="gerarRelatorioEstoque()">
                <div class="list-item-icon">📦</div>
                <div class="list-item-content">
                    <div class="list-item-title">Relatório de Estoque</div>
                    <div class="list-item-subtitle">Posição atual de todos os produtos</div>
                </div>
                <div class="list-item-right">
                    <button class="btn btn-primary btn-sm">Gerar</button>
                </div>
            </div>
            
            <div class="list-item" onclick="gerarRelatorioConsumo()">
                <div class="list-item-icon">📈</div>
                <div class="list-item-content">
                    <div class="list-item-title">Relatório de Consumo</div>
                    <div class="list-item-subtitle">Movimentações e consumo por produto</div>
                </div>
                <div class="list-item-right">
                    <button class="btn btn-primary btn-sm">Gerar</button>
                </div>
            </div>
            
            <div class="list-item" onclick="gerarRelatorioCompras()">
                <div class="list-item-icon">🛒</div>
                <div class="list-item-content">
                    <div class="list-item-title">Lista de Compras</div>
                    <div class="list-item-subtitle">Itens que precisam ser repostos</div>
                </div>
                <div class="list-item-right">
                    <button class="btn btn-primary btn-sm">Gerar</button>
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-title">📤 Exportar Dados</div>
            
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                <button class="btn btn-secondary" onclick="exportarTudoExcel()">📊 Tudo em Excel</button>
                <button class="btn btn-secondary" onclick="exportarTudoPDF()">📄 Tudo em PDF</button>
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
            
            <div class="sidebar-item" onclick="navigate('estoque')">
                <span class="icon">📊</span>
                <span>Estoque</span>
            </div>
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
                    
                    <div class="sidebar-item" onclick="navigate('entrada')">
                        <span class="icon">📥</span>
                        <span>Entrada de Estoque</span>
                    </div>
                    <div class="sidebar-item" onclick="navigate('fornecedores')">
                        <span class="icon">🏪</span>
                        <span>Fornecedores</span>
                    </div>
                    <div class="sidebar-item" onclick="navigate('compras')">
                        <span class="icon">🛒</span>
                        <span>Lista de Compras</span>
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
            
            <button class="btn btn-danger mt-4" onclick="confirmLogout()">Sair da Conta</button>
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
            <div class="action-btn like ${userRating === 'like' ? 'active' : ''}" onclick="rateProduct(${productId}, 'like')">
                <span class="icon">👍</span>
                <span>${produto.likes || 0}</span>
            </div>
            <div class="action-btn dislike ${userRating === 'dislike' ? 'active' : ''}" onclick="rateProduct(${productId}, 'dislike')">
                <span class="icon">👎</span>
                <span>${produto.dislikes || 0}</span>
            </div>
            <div class="action-btn" onclick="showQRCode('${qrCode}', '${produto.nome}')">
                <span class="icon">📱</span>
                <span>QR Code</span>
            </div>
        </div>
    `;
    
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
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
    
    try {
        const { error } = await supabaseClient
            .from('movimentacoes')
            .insert({
                produto_id: selectedProduct.id,
                user_id: currentUser.id,
                tipo: 'saida',
                quantidade: selectedQty
            });
        
        if (error) throw error;
        
        showToast(`${selectedQty}x ${selectedProduct.nome} registrado!`, 'success');
        closeModal();
        
        // Atualizar cache local
        const idx = cache.produtos.findIndex(p => p.id === selectedProduct.id);
        if (idx >= 0) {
            cache.produtos[idx].estoque -= selectedQty;
        }
        
        renderPage();
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao registrar consumo', 'error');
    }
}

async function quickConsume(productId) {
    const produto = cache.produtos.find(p => p.id === productId);
    if (!produto || produto.estoque < 1) {
        showToast('Produto sem estoque!', 'error');
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('movimentacoes')
            .insert({
                produto_id: productId,
                user_id: currentUser.id,
                tipo: 'saida',
                quantidade: 1
            });
        
        if (error) throw error;
        
        showToast(`1x ${produto.nome} ✓`, 'success');
        
        // Atualizar cache local
        const idx = cache.produtos.findIndex(p => p.id === productId);
        if (idx >= 0) {
            cache.produtos[idx].estoque -= 1;
        }
        
        renderPage();
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao registrar', 'error');
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
    
    const obs = document.getElementById('entrada-obs')?.value || '';
    
    try {
        const { error } = await supabaseClient
            .from('movimentacoes')
            .insert({
                produto_id: selectedProduct.id,
                user_id: currentUser.id,
                tipo: 'entrada',
                quantidade: selectedQty,
                observacao: obs
            });
        
        if (error) throw error;
        
        showToast(`+${selectedQty} ${selectedProduct.nome} adicionado!`, 'success');
        closeModal();
        
        // Atualizar cache
        const idx = cache.produtos.findIndex(p => p.id === selectedProduct.id);
        if (idx >= 0) {
            cache.produtos[idx].estoque += selectedQty;
        }
        
        renderPage();
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao dar entrada', 'error');
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
    `;
    
    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="submitSugestao()">Enviar</button>
    `;
    
    openModal('Nova Sugestão', body, footer);
}

async function submitSugestao() {
    const nome = document.getElementById('sugestao-nome').value.trim();
    const categoria = document.getElementById('sugestao-categoria').value;
    const justificativa = document.getElementById('sugestao-justificativa').value.trim();
    
    if (!nome) {
        showToast('Digite o nome do produto', 'error');
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('sugestoes')
            .insert({
                nome,
                categoria_id: categoria || null,
                justificativa,
                user_id: currentUser.id
            });
        
        if (error) throw error;
        
        showToast('Sugestão enviada!', 'success');
        closeModal();
        
        if (currentPage === 'sugestoes') {
            await loadSugestoes();
            renderPage();
        }
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao enviar sugestão', 'error');
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
    
    try {
        const { error } = await supabaseClient
            .from('alertas')
            .insert({
                produto_id: produto || null,
                urgencia,
                descricao,
                user_id: currentUser.id
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
        <button class="btn btn-primary" onclick="saveFornecedor(${fornecedorId || 'null'})">${fornecedor ? 'Salvar' : 'Cadastrar'}</button>
    `;
    
    openModal(fornecedor ? 'Editar Fornecedor' : 'Novo Fornecedor', body, footer);
}

async function saveFornecedor(id) {
    const data = {
        nome: document.getElementById('fornecedor-nome').value.trim(),
        contato: document.getElementById('fornecedor-contato').value.trim(),
        telefone: document.getElementById('fornecedor-telefone').value.trim(),
        email: document.getElementById('fornecedor-email').value.trim(),
        observacoes: document.getElementById('fornecedor-obs').value.trim()
    };
    
    if (!data.nome) {
        showToast('Digite o nome do fornecedor', 'error');
        return;
    }
    
    try {
        if (id) {
            const { error } = await supabaseClient.from('fornecedores').update(data).eq('id', id);
            if (error) throw error;
        } else {
            const { error } = await supabaseClient.from('fornecedores').insert(data);
            if (error) throw error;
        }
        
        showToast('Fornecedor salvo!', 'success');
        closeModal();
        await loadFornecedores();
        renderPage();
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao salvar', 'error');
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
    try {
        const current = cache.avaliacoes[productId];
        
        if (current === tipo) {
            // Remover avaliação
            const { error } = await supabaseClient
                .from('avaliacoes')
                .delete()
                .eq('produto_id', productId)
                .eq('user_id', currentUser.id);
            
            if (error) throw error;
            delete cache.avaliacoes[productId];
        } else {
            // Upsert avaliação
            const { error } = await supabaseClient
                .from('avaliacoes')
                .upsert({
                    produto_id: productId,
                    user_id: currentUser.id,
                    tipo
                }, { onConflict: 'produto_id,user_id' });
            
            if (error) throw error;
            cache.avaliacoes[productId] = tipo;
        }
        
        await loadProdutos();
        await loadAvaliacoes();
        
        if (selectedProduct?.id === productId) {
            openProductModal(productId);
        } else {
            renderPage();
        }
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao avaliar', 'error');
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
    confirmLogout();
}

// ============================================
// RELATÓRIOS E EXPORTAÇÕES
// ============================================
async function gerarRelatorioEstoque() {
    showToast('Gerando relatório...', 'success');
    
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

async function gerarRelatorioConsumo() {
    showToast('Gerando relatório...', 'success');
    await loadMovimentacoes();
    
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
        new Date(m.created_at).toLocaleString('pt-BR')
    ]);
    
    doc.autoTable({
        startY: 40,
        head: [['Produto', 'Tipo', 'Qtd', 'Usuário', 'Data']],
        body: data
    });
    
    doc.save('relatorio-consumo.pdf');
}

function gerarRelatorioCompras() {
    exportComprasPDF();
}

function exportComprasPDF() {
    showToast('Gerando PDF...', 'success');
    
    const itens = cache.produtos
        .filter(p => p.estoque <= p.estoque_minimo * 1.2)
        .map(p => {
            const consumoDiario = p.consumo_diario || 0.5;
            const necessario = Math.ceil(consumoDiario * 30);
            const comprar = Math.max(0, necessario - p.estoque);
            return { ...p, comprar };
        })
        .filter(p => p.comprar > 0);
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text('Lista de Compras', 14, 22);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 30);
    
    const data = itens.map(p => [
        p.nome,
        p.estoque,
        p.comprar,
        p.unidade
    ]);
    
    doc.autoTable({
        startY: 40,
        head: [['Produto', 'Estoque Atual', 'Comprar', 'Unidade']],
        body: data
    });
    
    doc.save('lista-compras.pdf');
}

function exportComprasExcel() {
    showToast('Gerando Excel...', 'success');
    
    const itens = cache.produtos
        .filter(p => p.estoque <= p.estoque_minimo * 1.2)
        .map(p => {
            const consumoDiario = p.consumo_diario || 0.5;
            const necessario = Math.ceil(consumoDiario * 30);
            const comprar = Math.max(0, necessario - p.estoque);
            return {
                Produto: p.nome,
                'Estoque Atual': p.estoque,
                'Quantidade Comprar': comprar,
                Unidade: p.unidade
            };
        })
        .filter(p => p['Quantidade Comprar'] > 0);
    
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
        Data: new Date(m.created_at).toLocaleString('pt-BR')
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
function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'agora';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
    
    return date.toLocaleDateString('pt-BR');
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

