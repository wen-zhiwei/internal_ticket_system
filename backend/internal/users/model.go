package users

import "errors"

type Role string

const (
	RoleAgent      Role = "agent"
	RoleSupervisor Role = "supervisor"
)

var (
	ErrNotFound    = errors.New("user not found")
	ErrInvalidRole = errors.New("invalid role")
)

type User struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Role      Role   `json:"role"`
	CreatedAt string `json:"created_at"`
}

func ParseRole(value string) (Role, error) {
	switch Role(value) {
	case RoleAgent, RoleSupervisor:
		return Role(value), nil
	default:
		return "", ErrInvalidRole
	}
}
