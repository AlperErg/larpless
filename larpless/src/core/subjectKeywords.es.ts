/**
 * Spanish names and keywords for the built-in subject library, used when Settings → Screen language is Español.
 * Keyed by the library subject's (English) name. They are added after a subject's English keywords, never in
 * place of them: Spanish course material still shows English jargon, tool names and course codes, and the first
 * three English keywords feed the fixed SigLIP prompts (FLScreenModelPrompts.json), which stay English.
 *
 * Same rules as the English keywords (subjectLibrary.ts), stricter where Spanish has everyday homographs: no
 * word that appears on many subjects' screens or on distractions ("función", "sistema", "serie" (TV), "oferta"
 * (shops), "valoración" (reviews), "hilo" (threads), "clasificación" (league tables), "ley", "van", "media").
 * Prefer a two-word term when the single word is ambiguous ("longitud de onda", "hilo de ejecución").
 * Watch page chrome too: Spanish Wikipedia shows "166 idiomas" on every article, so Languages isn't called "Idiomas".
 * __tests__/core/subjectLibrary.test.ts fails on a Spanish keyword shared by subjects in different groups.
 * Accents are optional for matching (both sides are accent-folded), but write them correctly.
 *
 * Pure data: no imports. Also read by scripts/embed_bench/export_subjects.mjs.
 */

export interface SubjectWordsEs {
  /** The subject's Spanish name; matched like a keyword. */
  name: string;
  keywords: string[];
}

export const SUBJECT_KEYWORDS_ES: Record<string, SubjectWordsEs> = {
  // Sciences
  Biology: { name: 'Biología', keywords: ['célula', 'mitosis', 'meiosis', 'ADN', 'ARN', 'proteína', 'enzima', 'genética', 'evolución', 'ecología', 'fotosíntesis', 'organismo'] },
  Chemistry: { name: 'Química', keywords: ['molécula', 'reacción química', 'estequiometría', 'tabla periódica', 'enlace químico', 'ácido', 'química orgánica', 'titulación', 'mol', 'equilibrio químico'] },
  Physics: { name: 'Física', keywords: ['fuerza', 'velocidad', 'aceleración', 'momento lineal', 'cinemática', 'electromagnetismo', 'cuántica', 'termodinámica', 'longitud de onda', 'óptica'] },
  Astronomy: { name: 'Astronomía', keywords: ['estrella', 'galaxia', 'planeta', 'cosmología', 'órbita', 'telescopio', 'agujero negro', 'corrimiento al rojo', 'astrofísica'] },
  'Earth Science': { name: 'Ciencias de la Tierra', keywords: ['geología', 'tectónica de placas', 'roca', 'mineral', 'clima', 'atmósfera', 'erosión', 'terremoto'] },
  'Environmental Science': { name: 'Ciencias Ambientales', keywords: ['ecosistema', 'sostenibilidad', 'cambio climático', 'contaminación', 'biodiversidad', 'energía renovable', 'huella de carbono'] },
  Neuroscience: { name: 'Neurociencia', keywords: ['neurona', 'sinapsis', 'cerebro', 'corteza cerebral', 'neurotransmisor', 'potencial de acción', 'cognición'] },

  // Maths
  Maths: { name: 'Matemáticas', keywords: ['ecuación', 'demostración', 'teorema', 'álgebra', 'geometría', 'trigonometría', 'hoja de ejercicios'] },
  Calculus: { name: 'Cálculo', keywords: ['derivada', 'integral', 'límite', 'diferenciación', 'integración', 'serie de potencias', 'serie de Taylor', 'ecuación diferencial', 'gradiente'] },
  'Linear Algebra': { name: 'Álgebra Lineal', keywords: ['matriz', 'vector', 'autovalor', 'autovector', 'valor propio', 'determinante', 'transformación lineal', 'base vectorial', 'subespacio'] },
  Statistics: { name: 'Estadística', keywords: ['varianza', 'desviación típica', 'desviación estándar', 'regresión', 'contraste de hipótesis', 'valor p', 'intervalo de confianza', 'media aritmética'] },
  Probability: { name: 'Probabilidad', keywords: ['variable aleatoria', 'Bayes', 'esperanza matemática', 'binomial', 'distribución normal', 'Markov', 'combinatoria'] },
  'Discrete Maths': { name: 'Matemática Discreta', keywords: ['inyectiva', 'sobreyectiva', 'biyectiva', 'teoría de conjuntos', 'lógica', 'inducción', 'teoría de grafos', 'relación binaria', 'álgebra de Boole'] },

  // Computing
  Programming: { name: 'Programación', keywords: ['código fuente', 'depuración', 'compilador', 'error de compilación', 'prueba unitaria', 'lenguaje de programación'] },
  Algorithms: { name: 'Algoritmos', keywords: ['algoritmo', 'estructura de datos', 'complejidad', 'ordenación', 'recursividad', 'programación dinámica', 'grafo', 'árbol', 'tabla hash'] },
  'Data Science': { name: 'Ciencia de Datos', keywords: ['conjunto de datos', 'visualización de datos', 'limpieza de datos'] },
  'Machine Learning': { name: 'Aprendizaje Automático', keywords: ['red neuronal', 'conjunto de entrenamiento', 'función de pérdida', 'descenso de gradiente', 'clasificador', 'sobreajuste'] },
  'Web Development': { name: 'Desarrollo Web', keywords: ['servidor web', 'hoja de estilos'] },
  Databases: { name: 'Bases de Datos', keywords: ['consulta', 'tabla', 'clave primaria', 'clave foránea', 'normalización', 'transacción', 'diagrama entidad-relación'] },
  'Digital Logic': { name: 'Lógica Digital', keywords: ['puerta lógica', 'biestable', 'tabla de verdad', 'mapa de Karnaugh', 'multiplexor', 'circuito digital'] },
  'Computer Architecture': { name: 'Arquitectura de Computadores', keywords: ['procesador', 'segmentación de cauce', 'ruta de datos', 'ensamblador', 'memoria caché', 'juego de instrucciones'] },
  'Operating Systems': { name: 'Sistemas Operativos', keywords: ['hilo de ejecución', 'planificador de procesos', 'gestión de memoria', 'paginación', 'interbloqueo', 'núcleo', 'sistema de archivos', 'concurrencia'] },
  Cybersecurity: { name: 'Ciberseguridad', keywords: ['cifrado', 'criptografía', 'vulnerabilidad', 'seguridad de redes', 'autenticación', 'cortafuegos', 'prueba de penetración'] },

  // Engineering
  'Electrical Engineering': { name: 'Ingeniería Eléctrica', keywords: ['circuito', 'voltaje', 'corriente eléctrica', 'resistencia eléctrica', 'condensador', 'amplificador operacional', 'transistor', 'ley de Ohm'] },
  'Mechanical Engineering': { name: 'Ingeniería Mecánica', keywords: ['estática', 'dinámica', 'tensión mecánica', 'deformación', 'mecánica de fluidos', 'par motor', 'ciencia de materiales'] },
  'Signals & Systems': { name: 'Señales y Sistemas', keywords: ['transformada de Fourier', 'transformada de Laplace', 'función de transferencia', 'convolución', 'frecuencia', 'filtro', 'muestreo', 'transformada z'] },

  // Humanities
  History: { name: 'Historia', keywords: ['revolución', 'guerra', 'imperio', 'siglo', 'fuente primaria', 'historiografía'] },
  Philosophy: { name: 'Filosofía', keywords: ['ética', 'epistemología', 'metafísica', 'Kant', 'Platón', 'Aristóteles'] },
  Literature: { name: 'Literatura', keywords: ['novela', 'poema', 'poesía', 'ensayo', 'comentario de texto', 'Cervantes', 'lectura atenta'] },
  Languages: { name: 'Lenguas Extranjeras', keywords: ['vocabulario', 'gramática', 'conjugación', 'tarjetas de memoria', 'traducción', 'francés', 'alemán'] },
  Linguistics: { name: 'Lingüística', keywords: ['fonética', 'fonología', 'sintaxis', 'semántica', 'morfología', 'pragmática', 'AFI'] },

  // Social sciences & business
  Economics: { name: 'Economía', keywords: ['curva de oferta', 'demanda', 'elasticidad', 'PIB', 'inflación', 'mercado', 'microeconomía', 'macroeconomía', 'equilibrio de mercado'] },
  Psychology: { name: 'Psicología', keywords: ['conducta', 'experimento', 'personalidad', 'memoria', 'percepción'] },
  Sociology: { name: 'Sociología', keywords: ['sociedad', 'cultura', 'desigualdad social', 'institución', 'teoría social', 'Durkheim', 'Weber'] },
  'Political Science': { name: 'Ciencia Política', keywords: ['gobierno', 'democracia', 'política pública', 'elecciones', 'relaciones internacionales', 'constitución'] },
  Law: { name: 'Derecho', keywords: ['jurisprudencia', 'contrato', 'responsabilidad civil', 'sentencia', 'jurídico', 'tribunal', 'código civil'] },
  Accounting: { name: 'Contabilidad', keywords: ['balance', 'cuenta de resultados', 'debe y haber', 'libro mayor', 'NIIF', 'flujo de caja', 'asiento contable'] },
  Finance: { name: 'Finanzas', keywords: ['valor actual neto', 'tipo de interés', 'renta variable', 'cartera de inversión', 'valoración de empresas', 'derivados financieros'] },
  'Information Management': { name: 'Gestión de la Información', keywords: ['diagrama de clases', 'caso de uso', 'requisitos', 'sistema de información', 'gestión de información'] },
  Business: { name: 'Empresa', keywords: ['estrategia', 'marketing', 'caso práctico', 'DAFO', 'operaciones', 'emprendimiento', 'plan de negocio'] },

  // Health & medicine
  Anatomy: { name: 'Anatomía', keywords: ['músculo', 'hueso', 'órgano', 'sistema nervioso', 'cardiovascular', 'esqueleto', 'tejido'] },
  Medicine: { name: 'Medicina', keywords: ['diagnóstico', 'patología', 'clínico', 'síntoma', 'paciente', 'fisiología', 'MIR'] },
  Pharmacology: { name: 'Farmacología', keywords: ['fármaco', 'dosis', 'receptor', 'farmacocinética', 'efecto secundario', 'agonista', 'antagonista'] },

  // Arts & design
  'Art History': { name: 'Historia del Arte', keywords: ['pintura', 'Renacimiento', 'movimiento artístico', 'escultura', 'museo', 'Impresionismo'] },
  'Music Theory': { name: 'Teoría Musical', keywords: ['escala', 'acorde', 'armonía', 'notación musical', 'contrapunto', 'armadura de clave'] },
  Design: { name: 'Diseño', keywords: ['tipografía', 'maquetación', 'teoría del color', 'prototipo', 'wireframe', 'retícula'] },
};

/**
 * The US/UK-style course-code prefixes in the English library keywords. Spanish universities don't use them, and on
 * Spanish screens they only match stray English words (bench: LAW and MUSIC fired on a Python tutorial and YouTube).
 */
export const ENGLISH_COURSE_CODES = new Set([
  'BIO', 'CHEM', 'PHYS', 'ASTR', 'GEO', 'ENVS', 'NEURO', 'MATH', 'STAT', 'EE', 'HIST', 'PHIL', 'ENGL', 'LING', 'ECON',
  'PSYC', 'SOC', 'POLS', 'LAW', 'ACCT', 'FIN', 'BUS', 'ANAT', 'PHARM', 'ARTH', 'MUSIC',
]);


/** Spanish counterparts of screenModel.ts' TEXT_DISTRACTIONS, added to them when the screen language is Español. */
export const TEXT_DISTRACTIONS_ES = [
  'redes sociales: me gusta, seguidores, comentarios, historias, reels, publicaciones',
  'compras en línea: añadir al carrito, precio, pagar, envío gratis, opiniones',
  'mensajes de chat: en línea, escribiendo, enviado, visto, grupo',
  'vídeo de entretenimiento: videoclip, suscribirse, lista de reproducción, visualizaciones, tráiler',
  'videojuego: jugar, nivel, puntuación, jugadores, partida',
  'streaming: ver ahora, episodio, temporada, seguir viendo',
];
