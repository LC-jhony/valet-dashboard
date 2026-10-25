package app

import "context"

func (a *App) DNSEnable(ctx context.Context) error {
	return a.withLock(func() error { return a.DNS.Enable(ctx) })
}

func (a *App) DNSDisable(ctx context.Context) error {
	return a.withLock(func() error { return a.DNS.Disable(ctx) })
}

func (a *App) DNSRepair(ctx context.Context) error {
	return a.withLock(func() error { return a.DNS.Repair(ctx) })
}

func (a *App) DNSCheck(ctx context.Context) (bool, string) {
	return a.DNS.Check(ctx)
}
