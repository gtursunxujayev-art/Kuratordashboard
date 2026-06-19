function normalize(value: string): string {
  return value.replace(/["'`]/g, '').toLowerCase();
}

export function isMissingPrismaColumnError(error: unknown, tableName: string, columnName: string): boolean {
  const code = String((error as any)?.code || '');
  const message = normalize(String((error as any)?.message || ''));
  const table = normalize(tableName);
  const column = normalize(columnName);
  const compactTable = table.replace(/_/g, '');
  const compactSingular = compactTable.replace(/s$/, '');
  const modelLike = table.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()).toLowerCase();

  const mentionsColumn =
    message.includes(`${table}.${column}`) ||
    message.includes(`${compactTable}.${column}`) ||
    message.includes(`${compactSingular}.${column}`) ||
    message.includes(`${modelLike}.${column}`) ||
    (message.includes(table) && message.includes(column)) ||
    (message.includes(compactTable) && message.includes(column)) ||
    (message.includes(compactSingular) && message.includes(column)) ||
    (message.includes(modelLike) && message.includes(column));

  if (code !== 'P2021' && code !== 'P2022' && code !== 'P2010') {
    return mentionsColumn && message.includes('does not exist');
  }

  return mentionsColumn;
}

export function isMissingCourseRunHiddenColumnError(error: unknown): boolean {
  return isMissingPrismaColumnError(error, 'course_runs', 'isHidden');
}

export function isMissingExerciseDefinitionHiddenColumnError(error: unknown): boolean {
  return isMissingPrismaColumnError(error, 'exercise_definitions', 'isHidden');
}

export function isMissingExerciseDefinitionStartDateColumnError(error: unknown): boolean {
  return isMissingPrismaColumnError(error, 'exercise_definitions', 'startDate');
}

export function isMissingExerciseDefinitionVisibilityColumnError(error: unknown): boolean {
  return (
    isMissingExerciseDefinitionHiddenColumnError(error) ||
    isMissingExerciseDefinitionStartDateColumnError(error)
  );
}

export function visibleCourseRunWhere(enabled: boolean): { isHidden: false } | Record<string, never> {
  return enabled ? { isHidden: false } : {};
}

export function visibleExerciseDefinitionWhere(enabled: boolean): { isHidden: false } | Record<string, never> {
  return enabled ? { isHidden: false } : {};
}

export async function withCourseRunVisibilityFallback<T>(
  query: (withHiddenColumn: boolean) => Promise<T>,
): Promise<T> {
  try {
    return await query(true);
  } catch (error) {
    if (!isMissingCourseRunHiddenColumnError(error)) {
      throw error;
    }
    return query(false);
  }
}

export async function withExerciseDefinitionVisibilityFallback<T>(
  query: (withVisibilityColumns: boolean) => Promise<T>,
): Promise<T> {
  try {
    return await query(true);
  } catch (error) {
    if (!isMissingExerciseDefinitionVisibilityColumnError(error)) {
      throw error;
    }
    return query(false);
  }
}
