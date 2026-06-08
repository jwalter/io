import { toast } from "sonner";

export function notifySuccess(msg: string) {
  toast.success(msg, { duration: 3000 });
}

export function notifyError(msg: string) {
  toast.error(msg, { duration: 5000 });
}

export function notifyInfo(msg: string) {
  toast(msg, { duration: 3000 });
}
