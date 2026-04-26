export interface Holiday {
  date: string
  localName: string
  name: string
}

export async function getCountryHolidays(
  countryCode: string,
  year: number
): Promise<Holiday[]> {
  try {
    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`)
    if (!response.ok) throw new Error(`Failed to fetch holidays for ${countryCode}`)
    return await response.json()
  } catch (error) {
    console.error('Error fetching holidays:', error)
    return []
  }
}

export async function isHoliday(countryCode: string, date: Date): Promise<boolean> {
  const year = date.getFullYear()
  const holidays = await getCountryHolidays(countryCode, year)
  const dateStr = date.toISOString().split('T')[0]
  return holidays.some(holiday => holiday.date === dateStr)
}
