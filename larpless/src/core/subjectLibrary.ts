/**
 * Built-in subject library: LarpLess recognises these automatically, so users never have to pick subjects.
 * Users may add their own courses (Modules page), but not under a library subject's name.
 * Keywords are classifier hints (topics, jargon, tools, course-code prefixes). Colours skip gray/red, which
 * mean "away"/"distracted". Pure data: no imports except types.
 */
import type { StudyModule, TagColor } from '../contracts/domain';

export interface LibrarySubject {
  name: string;
  icon: string;
  color: TagColor;
  keywords: string[];
}

export interface SubjectGroup {
  title: string;
  presets: LibrarySubject[];
}

export const SUBJECT_GROUPS: SubjectGroup[] = [
  {
    title: 'Sciences',
    presets: [
      { name: 'Biology', icon: 'dna', color: 'green', keywords: ['cell', 'mitosis', 'meiosis', 'DNA', 'RNA', 'protein', 'enzyme', 'genetics', 'evolution', 'ecology', 'photosynthesis', 'organism', 'BIO'] },
      { name: 'Chemistry', icon: 'flask', color: 'yellow', keywords: ['molecule', 'reaction', 'stoichiometry', 'periodic table', 'bond', 'acid', 'base', 'organic chemistry', 'titration', 'mole', 'equilibrium', 'CHEM'] },
      { name: 'Physics', icon: 'atom', color: 'blue', keywords: ['force', 'velocity', 'acceleration', 'momentum', 'energy', 'Newton', 'kinematics', 'electromagnetism', 'quantum', 'thermodynamics', 'wave', 'optics', 'PHYS'] },
      { name: 'Astronomy', icon: 'telescope', color: 'purple', keywords: ['star', 'galaxy', 'planet', 'cosmology', 'orbit', 'telescope', 'black hole', 'redshift', 'astrophysics', 'ASTR'] },
      { name: 'Earth Science', icon: 'mountain', color: 'brown', keywords: ['geology', 'plate tectonics', 'rock', 'mineral', 'climate', 'atmosphere', 'erosion', 'earthquake', 'GEO'] },
      { name: 'Environmental Science', icon: 'leaf', color: 'green', keywords: ['ecosystem', 'sustainability', 'climate change', 'pollution', 'biodiversity', 'renewable energy', 'carbon', 'ENVS'] },
      { name: 'Neuroscience', icon: 'brain', color: 'pink', keywords: ['neuron', 'synapse', 'brain', 'cortex', 'neurotransmitter', 'action potential', 'cognition', 'NEURO'] },
    ],
  },
  {
    title: 'Maths',
    presets: [
      { name: 'Maths', icon: 'divide', color: 'blue', keywords: ['equation', 'proof', 'theorem', 'function', 'algebra', 'geometry', 'trigonometry', 'problem set', 'MATH'] },
      { name: 'Calculus', icon: 'sigma', color: 'blue', keywords: ['derivative', 'integral', 'limit', 'differentiation', 'integration', 'series', 'differential equation', 'gradient', 'Taylor'] },
      { name: 'Linear Algebra', icon: 'grid', color: 'purple', keywords: ['matrix', 'vector', 'eigenvalue', 'eigenvector', 'determinant', 'linear transformation', 'basis', 'span', 'rank'] },
      { name: 'Statistics', icon: 'chart', color: 'orange', keywords: ['mean', 'variance', 'standard deviation', 'regression', 'hypothesis test', 'p-value', 'confidence interval', 'distribution', 'ANOVA', 'R', 'RStudio', 'SPSS', 'STAT'] },
      { name: 'Probability', icon: 'dices', color: 'orange', keywords: ['probability', 'random variable', 'Bayes', 'expectation', 'binomial', 'normal distribution', 'Markov', 'combinatorics'] },
      { name: 'Discrete Maths', icon: 'hash', color: 'yellow', keywords: ['injective', 'surjective', 'set theory', 'logic', 'proof', 'induction', 'graph theory', 'relation', 'bijective', 'combinatorics', 'Boolean algebra'] },
    ],
  },
  {
    title: 'Computing',
    presets: [
      { name: 'Coding', icon: 'code', color: 'purple', keywords: ['python', 'javascript', 'typescript', 'java', 'C++', 'function', 'class', 'variable', 'debugging', 'compiler', 'git', 'VS Code', 'Xcode', 'exercise', 'CS'] },
      { name: 'Algorithms', icon: 'puzzle', color: 'blue', keywords: ['algorithm', 'data structure', 'big O', 'complexity', 'sorting', 'recursion', 'dynamic programming', 'graph', 'tree', 'hash table', 'LeetCode'] },
      { name: 'Data Science', icon: 'chartLine', color: 'orange', keywords: ['pandas', 'NumPy', 'dataframe', 'Jupyter', 'notebook', 'visualisation', 'SQL', 'dataset', 'Kaggle', 'feature'] },
      { name: 'Machine Learning', icon: 'bot', color: 'pink', keywords: ['neural network', 'training', 'model', 'loss function', 'gradient descent', 'PyTorch', 'TensorFlow', 'classification', 'transformer', 'overfitting'] },
      { name: 'Web Development', icon: 'globe', color: 'green', keywords: ['HTML', 'CSS', 'React', 'JavaScript', 'API', 'frontend', 'backend', 'HTTP', 'Node.js', 'DOM'] },
      { name: 'Databases', icon: 'database', color: 'brown', keywords: ['SQL', 'query', 'table', 'schema', 'join', 'normalisation', 'index', 'transaction', 'PostgreSQL', 'ER diagram'] },
      { name: 'Digital Logic', icon: 'cable', color: 'yellow', keywords: ['Verilog', 'FPGA', 'Logisim', 'logic gate', 'ModelSim', 'flip flop', 'truth table', 'Karnaugh map', 'multiplexer', 'register', 'clock', 'circuit', 'Quartus', 'GTKWave'] },
      { name: 'Computer Architecture', icon: 'cpu', color: 'blue', keywords: ['processor', 'pipeline', 'datapath', 'assembly', 'ISA', 'cache', 'RISC-V', 'MIPS', 'ALU', 'instruction set', 'Vivado', 'VHDL'] },
      { name: 'Operating Systems', icon: 'monitor', color: 'blue', keywords: ['process', 'thread', 'scheduling', 'memory management', 'paging', 'deadlock', 'kernel', 'file system', 'concurrency'] },
      { name: 'Cybersecurity', icon: 'shield', color: 'purple', keywords: ['encryption', 'cryptography', 'vulnerability', 'network security', 'authentication', 'firewall', 'malware', 'CTF', 'penetration testing'] },
    ],
  },
  {
    title: 'Engineering',
    presets: [
      { name: 'Electrical Engineering', icon: 'zap', color: 'yellow', keywords: ['circuit', 'voltage', 'current', 'resistor', 'capacitor', 'op-amp', 'signal', 'transistor', 'Ohm', 'EE'] },
      { name: 'Mechanical Engineering', icon: 'cog', color: 'brown', keywords: ['statics', 'dynamics', 'stress', 'strain', 'fluid mechanics', 'thermodynamics', 'CAD', 'torque', 'materials'] },
      { name: 'Signals & Systems', icon: 'waveform', color: 'blue', keywords: ['Fourier', 'Laplace', 'transfer function', 'convolution', 'frequency', 'filter', 'sampling', 'z-transform', 'MATLAB'] },
    ],
  },
  {
    title: 'Humanities',
    presets: [
      { name: 'History', icon: 'landmark', color: 'orange', keywords: ['revolution', 'war', 'empire', 'century', 'treaty', 'primary source', 'historiography', 'HIST'] },
      { name: 'Philosophy', icon: 'lightbulb', color: 'purple', keywords: ['ethics', 'epistemology', 'metaphysics', 'argument', 'Kant', 'Plato', 'Aristotle', 'logic', 'PHIL'] },
      { name: 'Literature', icon: 'book', color: 'pink', keywords: ['novel', 'poem', 'essay', 'analysis', 'theme', 'character', 'Shakespeare', 'close reading', 'ENGL'] },
      { name: 'Languages', icon: 'languages', color: 'green', keywords: ['vocabulary', 'grammar', 'conjugation', 'Duolingo', 'Anki', 'flashcards', 'translation', 'Spanish', 'French', 'German'] },
      { name: 'Linguistics', icon: 'type', color: 'brown', keywords: ['phonetics', 'phonology', 'syntax', 'semantics', 'morphology', 'IPA', 'pragmatics', 'LING'] },
    ],
  },
  {
    title: 'Social sciences & business',
    presets: [
      { name: 'Economics', icon: 'chartLine', color: 'green', keywords: ['supply', 'demand', 'elasticity', 'GDP', 'inflation', 'market', 'microeconomics', 'macroeconomics', 'equilibrium', 'ECON'] },
      { name: 'Psychology', icon: 'brain', color: 'pink', keywords: ['behaviour', 'cognition', 'experiment', 'personality', 'development', 'memory', 'perception', 'DSM', 'PSYC'] },
      { name: 'Sociology', icon: 'users', color: 'orange', keywords: ['society', 'culture', 'inequality', 'institution', 'social theory', 'Durkheim', 'Weber', 'SOC'] },
      { name: 'Political Science', icon: 'vote', color: 'blue', keywords: ['government', 'democracy', 'policy', 'election', 'international relations', 'constitution', 'POLS'] },
      { name: 'Law', icon: 'scale', color: 'brown', keywords: ['case law', 'statute', 'contract', 'tort', 'constitution', 'judgment', 'legal', 'court', 'LAW'] },
      { name: 'Accounting', icon: 'receipt', color: 'yellow', keywords: ['balance sheet', 'income statement', 'debit', 'credit', 'ledger', 'IFRS', 'GAAP', 'cash flow', 'ACCT'] },
      { name: 'Finance', icon: 'banknote', color: 'green', keywords: ['NPV', 'interest rate', 'bond', 'equity', 'portfolio', 'valuation', 'derivatives', 'risk', 'FIN'] },
      { name: 'Information Management', icon: 'library', color: 'blue', keywords: ['info management', 'class diagram', 'use case', 'UML', 'requirements', 'information system', 'ER diagram', 'information management'] },
      { name: 'Business', icon: 'briefcase', color: 'orange', keywords: ['strategy', 'marketing', 'management', 'case study', 'SWOT', 'operations', 'entrepreneurship', 'BUS'] },
    ],
  },
  {
    title: 'Health & medicine',
    presets: [
      { name: 'Anatomy', icon: 'bone', color: 'pink', keywords: ['muscle', 'bone', 'organ', 'nervous system', 'cardiovascular', 'skeleton', 'tissue', 'ANAT'] },
      { name: 'Medicine', icon: 'stethoscope', color: 'blue', keywords: ['diagnosis', 'pathology', 'clinical', 'symptom', 'treatment', 'patient', 'physiology', 'USMLE'] },
      { name: 'Pharmacology', icon: 'pill', color: 'purple', keywords: ['drug', 'dose', 'receptor', 'pharmacokinetics', 'side effect', 'agonist', 'antagonist', 'PHARM'] },
    ],
  },
  {
    title: 'Arts & design',
    presets: [
      { name: 'Art History', icon: 'palette', color: 'orange', keywords: ['painting', 'Renaissance', 'movement', 'artist', 'sculpture', 'museum', 'Impressionism', 'ARTH'] },
      { name: 'Music Theory', icon: 'music', color: 'purple', keywords: ['scale', 'chord', 'harmony', 'interval', 'notation', 'counterpoint', 'key signature', 'MUSIC'] },
      { name: 'Design', icon: 'pencil', color: 'pink', keywords: ['typography', 'layout', 'Figma', 'colour theory', 'UX', 'prototype', 'wireframe', 'grid'] },
    ],
  },
];

/** Stable id for a library subject, e.g. "Signals & Systems" → "lib_signals_systems". */
export function librarySubjectId(name: string): string {
  return `lib_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

/** The library as modules (first occurrence of a name wins). */
export const LIBRARY_MODULES: StudyModule[] = (() => {
  const seen = new Set<string>();
  const out: StudyModule[] = [];
  for (const g of SUBJECT_GROUPS) {
    for (const s of g.presets) {
      const k = s.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ id: librarySubjectId(s.name), name: s.name, color: s.color, keywords: s.keywords });
    }
  }
  return out;
})();

const LIBRARY_NAMES = new Map(LIBRARY_MODULES.map((m) => [m.name.toLowerCase(), m.name]));

/** The library's spelling of `name` when it's a built-in subject (case-insensitive), else null. */
export function librarySubjectName(name: string): string | null {
  return LIBRARY_NAMES.get(name.trim().toLowerCase()) ?? null;
}

/**
 * Every subject the classifier may choose: the user's own courses first, then the library minus any
 * subject whose name a user course already uses (case-insensitive).
 */
export function allSubjects(userCourses: readonly StudyModule[]): StudyModule[] {
  const taken = new Set(userCourses.map((m) => m.name.trim().toLowerCase()));
  return [...userCourses, ...LIBRARY_MODULES.filter((m) => !taken.has(m.name.toLowerCase()))];
}
