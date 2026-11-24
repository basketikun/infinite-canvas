declare module "fs-native-extensions" {
    export function tryLock(fd: number): boolean;
}
