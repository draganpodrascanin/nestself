import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Read a string value from AsyncStorage, returning null on failure.
 */
export async function getItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Write a string value to AsyncStorage, silently ignoring errors.
 */
export async function setItem(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable; silently ignore.
  }
}

/**
 * Remove a value from AsyncStorage, silently ignoring errors.
 */
export async function removeItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Storage may be unavailable; silently ignore.
  }
}
