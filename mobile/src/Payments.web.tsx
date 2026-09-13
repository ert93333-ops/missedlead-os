/**
 * 웹 결제 스텁: Stripe 미지원이므로 children을 그대로 통과시킨다.
 */
import type { ReactNode } from 'react';
export function Payments({children}:{readonly children:ReactNode}) { return <>{children}</>; }
