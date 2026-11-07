from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..db import get_db, row
from ..schemas import LoginIn
from ..security import (_DUMMY_HASH, create_session, current_user, delete_session, login_limiter,
                        verify_password)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(body: LoginIn, conn=Depends(get_db)):
    key = body.email.strip().lower()
    login_limiter.check(key)
    user = row(conn.execute("SELECT * FROM users WHERE email = ?", (key,)))
    ok = verify_password(body.password, user["password_hash"] if user else _DUMMY_HASH)
    if not user or not ok or not user["active"]:
        login_limiter.fail(key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect")
    login_limiter.success(key)
    token, expires_at = create_session(conn, user["id"])
    return {
        "token": token,
        "expires_at": expires_at,
        "user": {k: user[k] for k in ("id", "email", "name", "role", "team_role")},
    }


@router.post("/logout")
def logout(request: Request, user=Depends(current_user), conn=Depends(get_db)):
    delete_session(conn, request.state.token)
    return {"ok": True}


@router.get("/me")
def me(user=Depends(current_user)):
    return {k: user[k] for k in ("id", "email", "name", "role", "team_role")}
