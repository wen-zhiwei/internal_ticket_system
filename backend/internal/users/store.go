package users

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store interface {
	List(ctx context.Context, role *Role) ([]User, error)
	Get(ctx context.Context, id string) (User, error)
}

type PGStore struct {
	pool *pgxpool.Pool
}

func NewPGStore(pool *pgxpool.Pool) *PGStore {
	return &PGStore{pool: pool}
}

func (s *PGStore) List(ctx context.Context, role *Role) ([]User, error) {
	const baseQuery = `
		SELECT id::text, name, team, role, created_at::text
		FROM users
	`

	var rows pgx.Rows
	var err error
	if role == nil {
		rows, err = s.pool.Query(ctx, baseQuery+`ORDER BY name ASC`)
	} else {
		rows, err = s.pool.Query(ctx, baseQuery+`WHERE role = $1 ORDER BY name ASC`, string(*role))
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]User, 0)
	for rows.Next() {
		var user User
		if err := rows.Scan(&user.ID, &user.Name, &user.Team, &user.Role, &user.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, user)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *PGStore) Get(ctx context.Context, id string) (User, error) {
	const query = `
		SELECT id::text, name, team, role, created_at::text
		FROM users
		WHERE id::text = $1
	`

	var user User
	if err := s.pool.QueryRow(ctx, query, id).Scan(&user.ID, &user.Name, &user.Team, &user.Role, &user.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, err
	}
	return user, nil
}
